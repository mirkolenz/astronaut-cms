/**
 * Which entries reach which library file.
 *
 * The authoritative half is the same schema-driven walk the build does
 * (`collect-assets.ts`): a value is an asset because its schema says so, never
 * because the string looks like a path. That walk deliberately ignores markdown
 * bodies and Markdoc tags, which is right for deciding what to bundle and wrong
 * for deciding what is safe to delete, so a textual pass covers those too. A hit
 * there is reported as undeclared: it means "something mentions this", which is
 * all that is needed to stop a deletion.
 *
 * It runs here rather than in the admin because it is what a rename or a
 * deletion is refused on. A precondition only the caller checks is caller
 * discipline; this one is a rule of the library.
 */
import collections from "virtual:astronaut-cms/collections";
import config from "virtual:astronaut-cms/config";
import { components } from "virtual:astronaut-cms/user-config";
import { isLibraryFile, mediaPath } from "../shared/media.ts";
import { validateBody } from "../shared/body-validation.ts";
import { dataLeaves } from "../shared/resolvable-leaves.ts";
import { entryFilePath, type CollectionManifestEntry, type EntryContent } from "../shared/types.ts";
import type { AssetReference, ReferenceIndex } from "../shared/references.ts";
import type { StorageBackend } from "./storage/types.ts";

/** How many entry reads may be in flight at once. */
const CONCURRENCY = 10;

/** A worker pool: a fixed number of readers sharing one cursor, with no barriers. */
async function inParallel<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * Paths a body mentions with no schema to declare them. Bounded to a name with
 * an extension the library admits, and only a match under the library counts,
 * so ordinary prose cannot produce one. Bounded as well to a path-sized
 * run: the leading class contains `.` too, so an unbounded one backtracks
 * quadratically over a long stretch of dots that ends in no extension.
 */
function* textualPaths(body: string): Generator<string> {
  for (const [match] of body.matchAll(/[\w@./-]{1,200}\.[a-zA-Z0-9]+/g)) {
    if (isLibraryFile(match, config.mediaExtensions)) yield match;
  }
}

export function indexEntry(
  index: Map<string, AssetReference[]>,
  col: CollectionManifestEntry,
  entry: EntryContent,
): void {
  const base = entryFilePath(col, entry.id, entry.format);
  // Keyed by the library path a value resolves to, so a file an entry declares
  // is not counted again when its body also mentions it, however it is spelled.
  const declared = new Set<string>();

  const add = (value: string, where: string, isDeclared: boolean): void => {
    const path = mediaPath(value, config, base);

    if (path == null || (!isDeclared && declared.has(path))) return;

    if (isDeclared) declared.add(path);

    const reference = { collection: col.name, entryId: entry.id, where, declared: isDeclared };
    const existing = index.get(path);

    if (existing) existing.push(reference);
    else index.set(path, [reference]);
  };

  const body = validateBody(entry.body, entry.format, components);

  for (const leaf of [...dataLeaves(col.schema, entry.data), ...body.leaves]) {
    if (leaf.kind !== "reference") add(leaf.value, leaf.path, true);
  }

  // A markdown image names its file as plainly as a schema field does.
  for (const url of body.images) {
    add(url, "markdown image", true);
  }

  for (const value of textualPaths(entry.body)) add(value, "body", false);
}

/**
 * Walks every entry of every collection: one read per entry, so it is built on
 * demand rather than refreshed eagerly. Collections are listed together, then
 * their entries read through one bounded pool.
 *
 * A read that fails takes the whole scan with it. The index is what deletions
 * and renames are checked against, and an entry that could not be read cannot be
 * shown to reference nothing: skipping it would turn a transient provider error
 * into a file classified as unused and a destructive operation waved through.
 */
export async function buildReferenceIndex(storage: StorageBackend): Promise<ReferenceIndex> {
  const index = new Map<string, AssetReference[]>();
  const listings = await Promise.all(
    Object.values(collections).map(async (col) =>
      (await storage.listEntries(col.name)).map((meta) => ({ col, meta })),
    ),
  );

  await inParallel(listings.flat(), async ({ col, meta }) => {
    indexEntry(index, col, await storage.getEntry(col.name, meta.id, meta.format));
  });

  return [...index];
}
