import { create } from "zustand";
import type { FileChange } from "@/shared/types";

type Reviewed = ReadonlyMap<string, FileChange>;

/**
 * Which pending changes a human has opened on the Changes screen, by path.
 *
 * Publishing is gated on every change having been opened, so no content,
 * including AI-written content, is published without being shown to the person
 * who takes responsibility for it. In memory only, so a reload starts over.
 */
const useReviewStore = create<{ reviewed: Reviewed }>()(() => ({ reviewed: new Map() }));

// The patch and version are compared too, so any later edit to a file, by a
// human or an agent, makes it unreviewed again.
function isReviewed(reviewed: Reviewed, change: FileChange): boolean {
  const seen = reviewed.get(change.path);

  return (
    seen?.kind === change.kind &&
    seen.previousPath === change.previousPath &&
    seen.patch === change.patch &&
    seen.version === change.version
  );
}

export function markReviewed(change: FileChange): void {
  useReviewStore.setState((state) =>
    isReviewed(state.reviewed, change)
      ? state
      : { reviewed: new Map(state.reviewed).set(change.path, change) },
  );
}

/** Forgets every review, once the changeset it covered is published or discarded. */
export function clearReviews(): void {
  useReviewStore.setState({ reviewed: new Map() });
}

export function useIsReviewed(change: FileChange): boolean {
  return useReviewStore(({ reviewed }) => isReviewed(reviewed, change));
}

export function useReviewedCount(changes: readonly FileChange[]): number {
  return useReviewStore(
    ({ reviewed }) => changes.filter((change) => isReviewed(reviewed, change)).length,
  );
}
