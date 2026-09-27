/** A copy of `items` with the item at `from` moved to `to`. */
export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];

  next.splice(to, 0, ...next.splice(from, 1));

  return next;
}

/** Where the item at `from` ends up moved by `offset` places, stopping at either end. */
export const movedIndex = (length: number, from: number, offset: number): number =>
  Math.min(Math.max(from + offset, 0), length - 1);
