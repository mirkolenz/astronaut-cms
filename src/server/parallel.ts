/** How many reads may be in flight at once, which keeps a provider's rate limit in reach. */
const CONCURRENCY = 10;

/** A worker pool: a fixed number of readers sharing one iterator, with no barriers. */
export async function inParallel<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const cursor = items.values();

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (const item of cursor) await fn(item);
    }),
  );
}
