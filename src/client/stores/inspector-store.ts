import { create } from "zustand";
import type { LexicalEditor } from "lexical";
import type { ChildPath } from "@/client/lib/component-tree";

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

/**
 * The component whose props the inspector shows. There is one body editor at a
 * time, and the entry page clears the selection when it goes.
 */
const useInspectorStore = create<{ selection: BlockSelection | null; reveal: boolean }>()(() => ({
  selection: null,
  reveal: false,
}));

/**
 * Selects a block, or nothing. With `reveal`, the body scrolls to it, for a
 * selection made outside the body, such as in the inspector.
 */
export function selectBlock(selection: BlockSelection | null, { reveal = false } = {}): void {
  useInspectorStore.setState({ selection, reveal });
}

export function useSelection(): BlockSelection | null {
  return useInspectorStore((state) => state.selection);
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
  const selected = useInspectorStore((state) => state.selection !== null && sameBlock(state.selection, block));
  const reveal = useInspectorStore((state) => state.reveal);

  return { selected, reveal: selected && reveal };
}
