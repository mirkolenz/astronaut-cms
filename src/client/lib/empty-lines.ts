/**
 * Markdown has no empty paragraphs, since blank lines only separate blocks. An
 * empty line in the editor is a place to type or insert at: it is never
 * written to the file, and it goes away once the caret has left it.
 */
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  HISTORY_MERGE_TAG,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
} from "lexical";

export function $isEmptyLine(node: LexicalNode | null | undefined): node is ParagraphNode {
  return $isParagraphNode(node) && node.isEmpty();
}

/** The top-level block the caret is in. */
export function $caretBlock(): LexicalNode | null {
  const selection = $getSelection();

  if (!$isRangeSelection(selection)) return null;

  const node = selection.anchor.getNode();

  return $isRootOrShadowRoot(node) ? null : node.getTopLevelElement();
}

/**
 * Whether an empty line is left out of the file. The only line of an editor is
 * kept, since an inline component's text children are written from it.
 */
export function $isSkippedLine(node: LexicalNode): node is ParagraphNode {
  return $isEmptyLine(node) && node.getParent()?.getChildrenSize() !== 1;
}

/**
 * Removes the empty lines of an editor, but the one the caret is on and the one
 * MDXEditor keeps after a closing component.
 */
export function pruneEmptyLines(editor: LexicalEditor, { keepCaret = true } = {}): void {
  const keys = editor.getEditorState().read(() => {
    const caret = keepCaret ? $caretBlock() : null;
    const lines = $getRoot().getChildren();
    const stale = lines.filter(
      (node) =>
        $isEmptyLine(node) &&
        !node.is(caret) &&
        !(node.getNextSibling() === null && $isDecoratorNode(node.getPreviousSibling())),
    );

    // An editor keeps one line to type into.
    return (stale.length === lines.length ? stale.slice(1) : stale).map((node) => node.getKey());
  });

  if (keys.length === 0) return;

  editor.update(
    () => {
      for (const key of keys) $getNodeByKey(key)?.remove();
    },
    { tag: [HISTORY_MERGE_TAG, SKIP_DOM_SELECTION_TAG] },
  );
}
