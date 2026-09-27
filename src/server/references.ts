/**
 * What reaches which library file.
 *
 * The authoritative half is schema-driven: a value is an asset because its
 * schema says so, never because the string looks like a path. That misses prose
 * and Markdoc tags, which a textual pass covers too.
 * A hit there is reported as undeclared: it means "something mentions this",
 * which is all that is needed to stop a deletion.
 *
 * It runs here rather than in the admin because it is what a rename or a
 * deletion is refused on. A precondition only the caller checks is caller
 * discipline; this one is a rule of the library.
 */
import { client as config, components } from "virtual:astronaut-cms/server";
import { isLibraryFile, mediaLibrary, mediaPath } from "../shared/media.ts";
import { validateBody } from "../shared/body-validation.ts";
import { dataLeaves } from "../shared/resolvable-leaves.ts";
import { entryFilePath, type CollectionManifestEntry, type EntryContent } from "../shared/types.ts";
import { fileKey, type IndexedFile, type ReferenceIndex } from "../shared/references.ts";
import type { StorageBackend } from "./storage/types.ts";

/** How many entry reads may be in flight at once. */
const CONCURRENCY = 10;

/** A worker pool: a fixed number of readers sharing one iterator, with no barriers. */
async function inParallel<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const cursor = items.values();

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (const item of cursor) await fn(item);
    }),
  );
}

/**
 * Paths and object-store URLs a body mentions with no schema to declare them.
 * Only a match under a library counts, with an extension that library admits,
 * so ordinary prose cannot produce one. Bounded as well to a path-sized run:
 * the leading class contains `.` too, so an unbounded one backtracks
 * quadratically over a long stretch of dots that ends in no extension.
 */
function* textualPaths(body: string): Generator<string> {
  for (const [match] of body.matchAll(/(?:https?:)?[\w@.%/-]{1,200}\.[a-zA-Z0-9]+/g)) yield match;
}

export function indexEntry(
  index: Map<string, IndexedFile>,
  col: CollectionManifestEntry,
  entry: EntryContent,
): void {
  const base = entryFilePath(col, entry.id, entry.format);
  // Keyed by the library file a value resolves to, so a file an entry declares
  // is not counted again when its body also mentions it, however it is spelled.
  const declared = new Set<string>();

  const add = (value: string, where: string, isDeclared: boolean): void => {
    const location = mediaPath(value, config.media, base);

    if (location == null) return;

    const key = fileKey(location.library, location.path);

    if (isDeclared) {
      declared.add(key);
    } else {
      const { extensions } = mediaLibrary(config.media, location.library);

      if (declared.has(key) || !isLibraryFile(location.path, extensions)) return;
    }

    const reference = { collection: col.name, entryId: entry.id, where, declared: isDeclared };
    const existing = index.get(key);

    if (existing) existing.references.push(reference);
    else index.set(key, { ...location, references: [reference] });
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
  const index = new Map<string, IndexedFile>();
  const listings = await Promise.all(
    Object.values(config.collections).map(async (col) =>
      (await storage.listEntries(col.name)).map((meta) => ({ col, meta })),
    ),
  );

  await inParallel(listings.flat(), async ({ col, meta }) => {
    indexEntry(index, col, await storage.getEntry(col.name, meta.id, meta.format));
  });

  return [...index.values()];
}
