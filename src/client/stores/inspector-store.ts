import { create } from "zustand";
import type { LexicalEditor } from "lexical";
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
export interface FormSelection {
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

/**
 * Selects a block or a form, or nothing, with the `field` it has opened. With
 * `reveal`, the body scrolls to the block, for a selection made outside the
 * body, such as in the inspector.
 */
export function select(
  selection: Selection | null,
  { field = NO_FIELD, reveal = false }: { field?: ValuePath; reveal?: boolean } = {},
): void {
  useInspectorStore.setState({ selection, field, reveal });
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

export function sameBlock(a: BlockRef, b: BlockRef): boolean {
  return (
    a.editor === b.editor &&
    a.nodeKey === b.nodeKey &&
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
