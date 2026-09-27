import { create } from "zustand";
import {
  $createNodeSelection,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  HISTORIC_TAG,
  SKIP_DOM_SELECTION_TAG,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import type { Realm } from "@mdxeditor/editor";
import type { ChildPath } from "@/client/lib/component-tree";
import type { ValuePath } from "@/client/lib/field-values";

/** The Lexical node a component is written as, in the editor that holds it. */
export interface BlockNode {
  editor: LexicalEditor;
  nodeKey: string;
}

/** A component in the body, or one of its structured children by `path`. */
export interface BlockRef extends BlockNode {
  path: ChildPath;
}

/** A component the selected one is written inside of, for the breadcrumbs. */
export interface Crumb {
  label: string;
  selection: BlockSelection;
}

export interface BlockSelection extends BlockRef {
  /** The enclosing components outside the selected one's Lexical node, outermost first. */
  trail: readonly Crumb[];
}

/** The fields of an entry, one form each. */
interface FormSelection {
  form: string;
}

/** What the inspector shows. */
export type Selection = BlockSelection | FormSelection;

const NO_FIELD: ValuePath = [];

export const isBlockSelection = (selection: Selection): selection is BlockSelection => "editor" in selection;

/**
 * The body editor's realm, for what works on its content from outside it, and
 * what the inspector shows: a component or a form, and the value inside its
 * fields it has opened, such as an item of a list. There is one body editor at
 * a time, which clears the selection when it goes.
 */
const useInspectorStore = create<{
  realm: Realm | null;
  selection: Selection | null;
  /** Empty for the component itself, and for a form never so. */
  field: ValuePath;
  reveal: boolean;
}>()(() => ({ realm: null, selection: null, field: NO_FIELD, reveal: false }));

/** Sets the body editor's realm, which takes the selection in the one before along. */
export function setBodyRealm(realm: Realm | null): void {
  useInspectorStore.setState({ realm, selection: null, field: NO_FIELD, reveal: false });
}

export const getBodyRealm = (): Realm | null => useInspectorStore.getState().realm;

export function useBodyRealm(): Realm | null {
  return useInspectorStore((state) => state.realm);
}

/** Whether a node is selected as a whole, as a selected block is. */
export function $isNodeSelected(nodeKey: string): boolean {
  const selection = $getSelection();

  return $isNodeSelection(selection) && selection.has(nodeKey);
}

export const isNodeSelected = (state: EditorState, nodeKey: string): boolean =>
  state.read(() => $isNodeSelected(nodeKey));

// Selects a node as a whole, or nothing, without moving the focus. A change of
// the selection alone is no step of the history.
function selectNode(editor: LexicalEditor, nodeKey: string | null): void {
  editor.update(
    () => {
      if (nodeKey === null) {
        $setSelection(null);
        return;
      }

      const selection = $createNodeSelection();

      selection.add(nodeKey);
      $setSelection(selection);
    },
    { discrete: true, tag: [SKIP_DOM_SELECTION_TAG, HISTORIC_TAG] },
  );
}

/**
 * Selects a block or a form, or nothing, with the `field` it has opened. With
 * `reveal`, the body scrolls to the block, for a selection made outside the
 * body, such as in the inspector. A block is selected as a node of its editor
 * as well, so the keys act on it there, and the editors around it let go of
 * their selection, which would take the focus back on their next update.
 */
export function select(
  selection: Selection | null,
  { field = NO_FIELD, reveal = false }: { field?: ValuePath; reveal?: boolean } = {},
): void {
  const previous = getSelectedBlock();
  const next = selection && isBlockSelection(selection) ? selection : null;

  useInspectorStore.setState({ selection, field, reveal });

  // Within one editor, selecting the next node replaces the previous one.
  if (
    previous &&
    previous.editor !== next?.editor &&
    isNodeSelected(previous.editor.getEditorState(), previous.nodeKey)
  ) {
    selectNode(previous.editor, null);
  }

  if (!next) return;

  if (!isNodeSelected(next.editor.getEditorState(), next.nodeKey)) selectNode(next.editor, next.nodeKey);

  for (const { selection: crumb } of next.trail) {
    if (crumb.editor.getEditorState().read($getSelection) !== null) selectNode(crumb.editor, null);
  }
}

export const getSelection = (): Selection | null => useInspectorStore.getState().selection;

export function getSelectedBlock(): BlockSelection | null {
  const { selection } = useInspectorStore.getState();

  return selection && isBlockSelection(selection) ? selection : null;
}

export function useSelection(): Selection | null {
  return useInspectorStore((state) => state.selection);
}

export function useSelectedField(): ValuePath {
  return useInspectorStore((state) => state.field);
}

/** The value of a form the inspector shows, empty for none. */
export function useFormField(form: string): ValuePath {
  return useInspectorStore(({ selection, field }) =>
    selection && !isBlockSelection(selection) && selection.form === form ? field : NO_FIELD,
  );
}

export function sameNode(a: BlockNode, b: BlockNode): boolean {
  return a.editor === b.editor && a.nodeKey === b.nodeKey;
}

function sameBlock(a: BlockRef, b: BlockRef): boolean {
  return (
    sameNode(a, b) &&
    a.path.length === b.path.length &&
    a.path.every((key, index) => key === b.path[index])
  );
}

/** Whether the block is selected, and whether the body is to scroll to it. */
export function useIsSelected(block: BlockRef): { selected: boolean; reveal: boolean } {
  const selected = useInspectorStore(
    ({ selection }) => selection !== null && isBlockSelection(selection) && sameBlock(selection, block),
  );
  const reveal = useInspectorStore((state) => state.reveal);

  return { selected, reveal: selected && reveal };
}
