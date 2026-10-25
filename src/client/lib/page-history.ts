/**
 * The page's undo history. MDXEditor's editors share it, the body editor and
 * those nested in it, and so does the editor holding the page's forms. Each
 * step restores one editor to an earlier state, so a change made to an editor
 * from outside it first records where that editor stands, as focusing it
 * would. Undo and redo pass over the steps that change nothing, such as those
 * MDXEditor records as focus moves between its editors.
 */
import {
  $addUpdateTag,
  $getSelection,
  $isNodeSelection,
  COMMAND_PRIORITY_CRITICAL,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  REDO_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND,
  mergeRegister,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import {
  createEmptyHistoryState,
  type HistoryState,
  type HistoryStateEntry,
} from "@lexical/history";
import type { Cell } from "@mdxeditor/editor";

// MDXEditor exports the history its editors share, but its declarations leave it out as internal.
declare module "@mdxeditor/editor" {
  export const historyState$: ReturnType<typeof Cell<HistoryState>>;
}

/** The history of the page, which starts over with each page. */
export const pageHistory: HistoryState = createEmptyHistoryState();

/** Keystrokes in one field within this window make a single undo step. */
const MERGE_WINDOW = 1000;

let lastEdit: { key: string; at: number; state: EditorState } | undefined;

export function clearPageHistory(): void {
  // In place, since the editors sharing the history hold on to its stacks.
  pageHistory.undoStack.length = 0;
  pageHistory.redoStack.length = 0;
  pageHistory.current = null;
  lastEdit = undefined;
}

// A restored state without a caret leaves the focus where it is. A block
// selected as a whole stays so, as it takes no focus.
function unfocused(entry: HistoryStateEntry): HistoryStateEntry {
  const selection = entry.editorState.read($getSelection);

  return {
    ...entry,
    editorState: entry.editorState.clone($isNodeSelection(selection) ? selection.clone() : null),
  };
}

/**
 * Records where an editor stands before a change made to it from outside, as
 * focusing it would, unless it has that place already. Tells whether another
 * editor had it.
 */
export function claimHistory(editor: LexicalEditor): boolean {
  const { current } = pageHistory;

  if (current?.editor === editor) return false;

  if (current) pageHistory.undoStack.push(unfocused(current));

  pageHistory.current = { editor, editorState: editor.getEditorState() };

  return current !== null;
}

// Undone, a change made from outside the text leaves the focus where it is.
function claim(editor: LexicalEditor): boolean {
  const switched = claimHistory(editor);

  pageHistory.current = unfocused({ editor, editorState: editor.getEditorState() });

  return switched;
}

function update(editor: LexicalEditor, change: () => void, tag: string): void {
  editor.update(
    () => {
      // An edit made from outside the text must not pull focus back into it.
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      $addUpdateTag(tag);
      change();
    },
    { discrete: true },
  );
}

/**
 * Changes an editor from outside it as one undo step. Changes sharing a
 * `mergeKey`, such as typing into one field, merge into one step while they
 * follow each other closely, and only right on top of each other, never across
 * another change or an undo.
 */
export function historicUpdate(editor: LexicalEditor, change: () => void, mergeKey?: string): void {
  const switched = claim(editor);
  const at = Date.now();
  const merge =
    !switched &&
    mergeKey !== undefined &&
    lastEdit?.key === mergeKey &&
    at - lastEdit.at < MERGE_WINDOW &&
    lastEdit.state === editor.getEditorState();

  update(editor, change, merge ? HISTORY_MERGE_TAG : HISTORY_PUSH_TAG);
  lastEdit =
    mergeKey === undefined ? undefined : { key: mergeKey, at, state: editor.getEditorState() };
}

/** Changes an editor from outside it without an undo step, as where its history starts from. */
export function baseUpdate(editor: LexicalEditor, change: () => void): void {
  claim(editor);
  update(editor, change, HISTORY_MERGE_TAG);
}

// Committed editor states never change, so each is serialized once.
const serialized = new WeakMap<EditorState, string>();

function json(state: EditorState): string {
  let text = serialized.get(state);

  if (text === undefined) {
    text = JSON.stringify(state.toJSON());
    serialized.set(state, text);
  }

  return text;
}

// Whether restoring the entry would change its editor.
const changes = ({ editor, editorState }: HistoryStateEntry) =>
  json(editorState) !== json(editor.getEditorState());

/** Whether undo, or redo, has a step that changes something. */
export const hasStep = (stack: readonly HistoryStateEntry[]): boolean =>
  stack.findLast(changes) !== undefined;

let skipping = false;

// Passes over the steps that change nothing before the history takes the next one.
function skipUnchanged(
  editor: LexicalEditor,
  command: typeof UNDO_COMMAND,
  stack: HistoryStateEntry[],
): false {
  if (skipping) return false;

  skipping = true;

  try {
    for (let top = stack.at(-1); top && !changes(top); top = stack.at(-1)) {
      stack[stack.length - 1] = unfocused(top);
      editor.dispatchCommand(command, undefined);
    }
  } finally {
    skipping = false;
  }

  return false;
}

/** Lets undo and redo in an editor sharing the page's history pass over the steps that change nothing. */
export function registerSkipUnchanged(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerCommand(
      UNDO_COMMAND,
      () => skipUnchanged(editor, UNDO_COMMAND, pageHistory.undoStack),
      COMMAND_PRIORITY_CRITICAL,
    ),
    editor.registerCommand(
      REDO_COMMAND,
      () => skipUnchanged(editor, REDO_COMMAND, pageHistory.redoStack),
      COMMAND_PRIORITY_CRITICAL,
    ),
  );
}
