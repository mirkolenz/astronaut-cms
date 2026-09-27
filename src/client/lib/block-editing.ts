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
  type LexicalNode,
} from "lexical";
import { NESTED_EDITOR_UPDATED_COMMAND } from "@mdxeditor/editor";
import type { MdxJsxElement } from "@/shared/jsx-editor";
import type { ClientComponentDef } from "@/internal/user-config";
import { selectBlock, type BlockNode, type BlockSelection } from "@/client/stores/inspector-store";
import {
  addChild,
  childKey,
  duplicateChild,
  moveChild,
  newChild,
  removeChild,
  type ChildPath,
} from "@/client/lib/component-tree";

interface JsxNode extends LexicalNode {
  getMdastNode(): MdxJsxElement;
  setMdastNode(node: MdxJsxElement): void;
}

// MDXEditor keeps its JSX node class to itself, so the node is known by its type.
function isJsxNode(node: LexicalNode | null): node is JsxNode {
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

/** The current element of a block, or `undefined` once it or its editor is gone. */
export function useBlockElement({ editor, nodeKey }: BlockNode): MdxJsxElement | undefined {
  const subscribe = useCallback((onChange: () => void) => editor.registerUpdateListener(onChange), [editor]);
  const read = useCallback(
    () =>
      editor.getRootElement() === null
        ? undefined
        : editor.getEditorState().read(() => {
            const node = $getNodeByKey(nodeKey);

            return isJsxNode(node) ? node.getMdastNode() : undefined;
          }),
    [editor, nodeKey],
  );

  return useSyncExternalStore(subscribe, read);
}

export interface BlockActions {
  move: (offset: -1 | 1) => void;
  duplicate: () => void;
  remove: () => void;
}

/**
 * What can be done to a block as a whole. A component in the text moves among
 * the nodes of its editor, a structured child among its siblings.
 */
export function blockActions(block: BlockNode, path: ChildPath): BlockActions {
  const key = path.at(-1);

  if (key === undefined) {
    return {
      move: (offset) =>
        editNode(block, (node) => {
          const sibling = offset < 0 ? node.getPreviousSibling() : node.getNextSibling();

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

  const parent = path.slice(0, -1);

  return {
    move: (offset) => updateBlock(block, (root) => moveChild(root, parent, key, offset)),
    duplicate: () => updateBlock(block, (root) => duplicateChild(root, parent, key)),
    remove: () => updateBlock(block, (root) => removeChild(root, parent, key)),
  };
}

/** Appends a new structured child to the selected block and selects it, so its props can be filled in. */
export function insertChild(parent: BlockSelection, name: string, def: ClientComponentDef): void {
  const child = newChild(name, def);

  updateBlock(parent, (root) => addChild(root, parent.path, child));
  selectBlock({ ...parent, path: [...parent.path, childKey(child)] }, { reveal: true });
}
