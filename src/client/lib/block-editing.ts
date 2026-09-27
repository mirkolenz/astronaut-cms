/**
 * Editing a component block from anywhere, the inspector outside the editor
 * included: the block is found by its Lexical node, and every change is written
 * to that node and passed on to the editors enclosing it.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
  $copyNode,
  $getNodeByKey,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { NESTED_EDITOR_UPDATED_COMMAND } from "@mdxeditor/editor";
import type { MdxJsxElement } from "@/shared/jsx-editor";
import type { ClientComponentDef } from "@/internal/user-config";
import {
  getBodyRealm,
  select,
  type BlockNode,
  type BlockRef,
  type BlockSelection,
} from "@/client/stores/inspector-store";
import {
  addChildren,
  asBlockContent,
  childKey,
  duplicateChild,
  findAt,
  moveChild,
  newComponent,
  removeChild,
  type JsxChild,
} from "@/client/lib/component-tree";
import { $isEmptyLine } from "@/client/lib/empty-lines";
import { historicUpdate } from "@/client/lib/page-history";
import { pastedChildren, readClipboard, toMdx, writeClipboard } from "@/client/lib/editor-content";

interface JsxNode extends LexicalNode {
  getMdastNode(): JsxChild;
  setMdastNode(node: MdxJsxElement): void;
}

// MDXEditor keeps its JSX node class to itself, so the node is known by its type.
export function isJsxNode(node: LexicalNode | null): node is JsxNode {
  return node?.getType() === "jsx";
}

// Every edit is an undo step of its own, or merges into the last one by `mergeKey`.
function editNode({ editor, nodeKey }: BlockNode, edit: (node: JsxNode) => void, mergeKey?: string): void {
  historicUpdate(
    editor,
    () => {
      const node = $getNodeByKey(nodeKey);

      if (isJsxNode(node)) edit(node);
    },
    mergeKey,
  );

  // An enclosing nested editor writes itself back to its own element in turn.
  editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
}

/** Replaces a block's element, merging edits that share a `mergeKey`, such as typing into one field. */
export function updateBlock(
  block: BlockNode,
  update: (element: MdxJsxElement) => MdxJsxElement,
  mergeKey?: string,
): void {
  editNode(block, (node) => node.setMdastNode(update(node.getMdastNode())), mergeKey);
}

/**
 * Clears the text selection of the editors holding a block as the inspector
 * takes focus. Lexical puts a selection back into the page on each update,
 * which would pull focus out of the inspector.
 */
export function releaseEditors({ editor, trail }: BlockSelection): void {
  for (const holder of new Set([editor, ...trail.map((crumb) => crumb.selection.editor)])) {
    holder.update(() => $setSelection(null), { tag: SKIP_DOM_SELECTION_TAG });
  }
}

/** The current element of the component a block is written as, or `undefined` once it or its editor is gone. */
function readElement({ editor, nodeKey }: BlockNode): JsxChild | undefined {
  return editor.getRootElement() === null
    ? undefined
    : editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey);

        return isJsxNode(node) ? node.getMdastNode() : undefined;
      });
}

/** A value read from an editor, and read again after each of its updates. */
export function useEditorValue<T>(editor: LexicalEditor, read: () => T): T {
  const subscribe = useCallback((onChange: () => void) => editor.registerUpdateListener(onChange), [editor]);

  return useSyncExternalStore(subscribe, read);
}

export function useBlockElement(block: BlockNode): MdxJsxElement | undefined {
  return useEditorValue(block.editor, () => readElement(block));
}

/** A block's MDX, as copying puts it on the clipboard. */
export function blockMdx(block: BlockRef): string | undefined {
  const root = readElement(block);
  const element = root && findAt(root, block.path);
  const realm = getBodyRealm();

  return element && realm ? toMdx(realm, [asBlockContent(element)]) : undefined;
}

export interface BlockActions {
  move: (offset: -1 | 1) => void;
  duplicate: () => void;
  copy: () => void;
  cut: () => void;
  remove: () => void;
}

// A block moves past the empty lines, which are no part of the file.
function $sibling(node: LexicalNode, offset: -1 | 1): LexicalNode | null {
  let sibling = offset < 0 ? node.getPreviousSibling() : node.getNextSibling();

  while ($isEmptyLine(sibling)) sibling = offset < 0 ? sibling.getPreviousSibling() : sibling.getNextSibling();

  return sibling;
}

/**
 * How a block moves and goes. A component in the text moves among the nodes of
 * its editor, a structured child among its siblings.
 */
function structureActions(block: BlockRef): Omit<BlockActions, "copy" | "cut"> {
  const key = block.path.at(-1);

  if (key === undefined) {
    return {
      move: (offset) =>
        editNode(block, (node) => {
          const sibling = $sibling(node, offset);

          if (offset < 0) sibling?.insertBefore(node);
          else sibling?.insertAfter(node);
        }),
      duplicate: () => editNode(block, (node) => node.insertAfter($copyNode(node))),
      remove: () =>
        editNode(block, (node) => {
          node.selectNext();
          node.remove();
        }),
    };
  }

  const parent = block.path.slice(0, -1);

  return {
    move: (offset) => updateBlock(block, (root) => moveChild(root, parent, key, offset)),
    duplicate: () => updateBlock(block, (root) => duplicateChild(root, parent, key)),
    remove: () => updateBlock(block, (root) => removeChild(root, parent, key)),
  };
}

/** Completes how something moves and goes with copying it as `text`, and cutting it. */
export function clipboardActions(
  actions: Omit<BlockActions, "copy" | "cut">,
  text: () => string | undefined,
): BlockActions {
  const copy = async () => {
    const copied = text();

    return copied !== undefined && (await writeClipboard(copied));
  };

  return {
    ...actions,
    copy: () => void copy(),
    cut: () => void copy().then((copied) => copied && actions.remove()),
  };
}

/** What can be done to a block as a whole. */
export function blockActions(block: BlockRef): BlockActions {
  return clipboardActions(structureActions(block), () => blockMdx(block));
}

// The added children are selected, so their props can be filled in.
function addAndSelect(parent: BlockSelection, children: JsxChild[]): void {
  const [first] = children;

  if (!first) return;

  updateBlock(parent, (root) => addChildren(root, parent.path, children));
  select({ ...parent, path: [...parent.path, childKey(first)] }, { reveal: true });
}

export function insertChild(parent: BlockSelection, name: string, def: ClientComponentDef): void {
  addAndSelect(parent, [newComponent(name, def)]);
}

/** Appends the components on the clipboard to the selected block's structured children. */
export async function pasteChildren(
  parent: BlockSelection,
  childDefs: Record<string, ClientComponentDef>,
): Promise<void> {
  const text = await readClipboard();
  const realm = getBodyRealm();
  const children = text && realm ? pastedChildren(realm, text, childDefs) : undefined;

  if (children) addAndSelect(parent, children);
}
