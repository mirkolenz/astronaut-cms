/**
 * Editing a component block from anywhere, the inspector outside the editor
 * included: the block is found by its Lexical node, and every change is written
 * to that node and passed on to the editors enclosing it.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
  $addUpdateTag,
  $copyNode,
  $getNodeByKey,
  $setSelection,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { NESTED_EDITOR_UPDATED_COMMAND } from "@mdxeditor/editor";
import type { MdxJsxElement } from "@/shared/jsx-editor";
import type { ClientComponentDef } from "@/internal/user-config";
import {
  getBodyRealm,
  selectBlock,
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
import { pastedChildren, readClipboard, toMdx, writeClipboard } from "@/client/lib/editor-content";

interface JsxNode extends LexicalNode {
  getMdastNode(): JsxChild;
  setMdastNode(node: MdxJsxElement): void;
}

// MDXEditor keeps its JSX node class to itself, so the node is known by its type.
export function isJsxNode(node: LexicalNode | null): node is JsxNode {
  return node?.getType() === "jsx";
}

function editNode({ editor, nodeKey }: BlockNode, edit: (node: JsxNode) => void): void {
  editor.update(
    () => {
      // An edit made from outside the text must not pull focus back into it.
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);

      const node = $getNodeByKey(nodeKey);

      if (isJsxNode(node)) edit(node);
    },
    { discrete: true },
  );

  // An enclosing nested editor writes itself back to its own element in turn.
  editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
}

// Keystrokes in one field within this window make a single undo step.
const MERGE_WINDOW = 1000;

let lastEdit: { key: string; at: number; state: EditorState } | undefined;

/**
 * Replaces a block's element. Edits sharing a `mergeKey`, such as typing into
 * one field, merge into one undo step while they follow each other closely,
 * and only right on top of each other, never across another change or an undo.
 */
export function updateBlock(
  block: BlockNode,
  update: (element: MdxJsxElement) => MdxJsxElement,
  mergeKey?: string,
): void {
  const now = Date.now();
  const merge =
    mergeKey !== undefined &&
    lastEdit?.key === mergeKey &&
    now - lastEdit.at < MERGE_WINDOW &&
    lastEdit.state === block.editor.getEditorState();

  editNode(block, (node) => {
    $addUpdateTag(merge ? HISTORY_MERGE_TAG : HISTORY_PUSH_TAG);
    node.setMdastNode(update(node.getMdastNode()));
  });

  lastEdit = mergeKey === undefined ? undefined : { key: mergeKey, at: now, state: block.editor.getEditorState() };
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

/** What can be done to a block as a whole. */
export function blockActions(block: BlockRef): BlockActions {
  const actions = structureActions(block);
  const copy = async () => {
    const mdx = blockMdx(block);

    return mdx !== undefined && (await writeClipboard(mdx));
  };

  return {
    ...actions,
    copy: () => void copy(),
    cut: () => void copy().then((copied) => copied && actions.remove()),
  };
}

// The added children are selected, so their props can be filled in.
function addAndSelect(parent: BlockSelection, children: JsxChild[]): void {
  const [first] = children;

  if (!first) return;

  updateBlock(parent, (root) => addChildren(root, parent.path, children));
  selectBlock({ ...parent, path: [...parent.path, childKey(first)] }, { reveal: true });
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
