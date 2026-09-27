/**
 * Markdown has no empty paragraphs, since blank lines only separate blocks. An
 * empty line in the editor is a place to type or insert at: it is never
 * written to the file, and it goes away once the caret has left it. Next to a
 * block without text of its own, such as a component or a table, the caret
 * sits in the gap between the blocks until it gets such a line.
 */
import {
  $createParagraphNode,
  $getEditor,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $needsBlockCursorBeside,
  HISTORY_MERGE_TAG,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
  type RangeSelection,
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

/** The caret where it sits between the top-level blocks rather than in one, as Lexical draws it in a gap. */
export function $caretBetweenBlocks(): RangeSelection | null {
  const selection = $getSelection();

  return $isRangeSelection(selection) && selection.isCollapsed() && $isRootOrShadowRoot(selection.anchor.getNode())
    ? selection
    : null;
}

/**
 * Makes the selection a caret where content goes: right after a block selected
 * as a whole, or at the end without a selection.
 */
export function $selectInsertPoint(): void {
  const selection = $getSelection();

  if ($isRangeSelection(selection)) return;

  const block = $isNodeSelection(selection) ? selection.getNodes().at(-1) : undefined;

  if (!block) {
    $getRoot().selectEnd();
    return;
  }

  const index = block.getIndexWithinParent() + 1;

  block.getParentOrThrow().select(index, index);
}

/**
 * Moves the caret onto an empty line for a block, so the block never splits
 * the text around it: the line it is on, a new one in the gap it is in, or the
 * one after its block.
 */
export function $moveToEmptyLine(): void {
  $selectInsertPoint();

  const gap = $caretBetweenBlocks();

  if (gap) {
    gap.insertParagraph();
    return;
  }

  const block = $caretBlock();

  if (!block || $isEmptyLine(block)) return;

  const next = block.getNextSibling();
  const line = $isEmptyLine(next) ? next : $createParagraphNode();

  if (line !== next) block.insertAfter(line);

  line.select();
}

/**
 * The gap between the top-level blocks of an editor at a height on screen, if
 * the caret only gets there as a gap, since the blocks on both sides of it
 * have no text of their own.
 */
export function $gapAt(y: number): number | undefined {
  const editor = $getEditor();
  const blocks = $getRoot().getChildren();
  const rects = blocks.map((block) => editor.getElementByKey(block.getKey())?.getBoundingClientRect());

  if (blocks.length === 0 || rects.some((rect) => rect !== undefined && rect.top <= y && y <= rect.bottom)) {
    return undefined;
  }

  const next = rects.findIndex((rect) => rect !== undefined && rect.top > y);
  const index = next === -1 ? blocks.length : next;
  const before = blocks[index - 1];
  const after = blocks[index];
  const textless = (block: LexicalNode | undefined) => block === undefined || $needsBlockCursorBeside(block);

  return textless(before) && textless(after) ? index : undefined;
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
