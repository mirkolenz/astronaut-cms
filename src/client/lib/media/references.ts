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
 */
import collections from "virtual:astronaut-cms/collections";
import config from "virtual:astronaut-cms/config";
import { components } from "virtual:astronaut-cms/user-config";
import { matchesGlob } from "pathe";
import { hasAllowedExtension, mediaPath } from "@shared/media";
import { validateMdx } from "@shared/mdx-validation";
import { dataLeaves } from "@shared/resolvable-leaves";
import { entryFilePath, type CollectionManifestEntry, type EntryContent } from "@shared/types";
import { diagnostic, type Diagnostic } from "@shared/diagnostics";
import { queryClient } from "@client/lib/query-client";
import { getStorage } from "@client/lib/storage";

export interface AssetReference {
  collection: string;
  entryId: string;
  /** The field or prop holding it, or the body it was found in. */
  where: string;
  /** False when only a textual match backs it, e.g. a markdown image. */
  declared: boolean;
}

/** Library path to everything that reaches it. */
export type ReferenceIndex = Map<string, AssetReference[]>;

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

function add(index: ReferenceIndex, value: string, base: string, reference: AssetReference): void {
  const path = mediaPath(value, config, base);

  if (path == null) return;

  const existing = index.get(path);

  if (existing) existing.push(reference);
  else index.set(path, [reference]);
}

/**
 * Paths a body mentions with no schema to declare them. Bounded to the library's
 * own extensions, so ordinary prose cannot produce a match, and to a path-sized
 * run: the leading class contains `.` too, so an unbounded one backtracks
 * quadratically over a long stretch of dots that ends in no extension.
 */
function* textualPaths(body: string): Generator<string> {
  for (const [match] of body.matchAll(/[\w@./-]{1,200}\.[a-zA-Z0-9]+/g)) {
    if (hasAllowedExtension(match, config.mediaExtensions)) yield match;
  }
}

export function indexEntry(
  index: ReferenceIndex,
  col: CollectionManifestEntry,
  entry: EntryContent,
): void {
  const base = entryFilePath(col, entry.id, entry.format);
  const reference = (where: string, declared: boolean): AssetReference => ({
    collection: col.name,
    entryId: entry.id,
    where,
    declared,
  });

  for (const leaf of [
    ...dataLeaves(col.schema, entry.data),
    ...validateMdx(entry.body, entry.format, components).leaves,
  ]) {
    if (leaf.kind !== "reference") add(index, leaf.value, base, reference(leaf.path, true));
  }

  for (const value of textualPaths(entry.body)) {
    add(index, value, base, reference("body", false));
  }
}

/**
 * Walks every entry of every collection: one read per entry, so callers run it
 * on demand and cache the result rather than refreshing it eagerly. Collections
 * are listed together, then their entries read through one bounded pool.
 */
async function buildReferenceIndex(): Promise<ReferenceIndex> {
  const storage = getStorage();
  const index: ReferenceIndex = new Map();
  const listings = await Promise.all(
    Object.values(collections).map(async (col) =>
      (await storage.listEntries(col.name)).map((meta) => ({ col, meta })),
    ),
  );

  await inParallel(listings.flat(), async ({ col, meta }) => {
    try {
      indexEntry(index, col, await storage.getEntry(col.name, meta.id, meta.format));
    } catch {
      // An unreadable entry cannot be shown to reference nothing, so it is
      // skipped rather than counted as evidence that a file is unused.
    }
  });

  return index;
}

/**
 * What a file is, as far as anything can tell: reached by content, kept by
 * `media.alwaysInclude` although nothing references it, or reached by nothing at
 * all. Every kind of evidence counts as `used`, textual included — the question
 * is whether deleting the file is safe, and a maybe is enough to say no.
 */
export type Usage = "used" | "always-included" | "orphan";

export function classifyUsage(paths: string[], index: ReferenceIndex): Map<string, Usage> {
  return new Map(
    paths.map((path) => [
      path,
      index.has(path) ? "used" : alwaysIncluded(path) ? "always-included" : "orphan",
    ]),
  );
}

/**
 * Whether the build keeps a file no content references. Only a repository
 * library is bundled, so `alwaysInclude` says nothing about an object store.
 * `matchesGlob` is the same matcher the build globs with, so the two cannot
 * disagree about which files the option covers.
 */
function alwaysIncluded(path: string): boolean {
  return (
    config.mediaBackend.type === "repo" &&
    config.mediaAlwaysInclude.some((pattern) => matchesGlob(path, pattern))
  );
}

/** A reference to a file the library does not hold. */
interface StaleReference extends AssetReference {
  path: string;
}

/**
 * References pointing at nothing. Only schema-declared ones are reported: a
 * textual match is good enough to stop a deletion but not to accuse an entry of
 * being broken, since prose can hold a path-shaped string that names no asset.
 *
 * With a repository library the build catches these; with an object store
 * nothing else does, which is why the admin reports them.
 */
export function staleReferences(index: ReferenceIndex, paths: string[]): StaleReference[] {
  const existing = new Set(paths);

  return [...index]
    .filter(([path]) => !existing.has(path))
    .flatMap(([path, references]) =>
      references.filter((r) => r.declared).map((reference) => ({ ...reference, path })),
    );
}

export const REFERENCES_QUERY = {
  // Derived from entries, not from the library, so it deliberately sits outside
  // the media key that every upload and delete invalidates.
  queryKey: ["cms", "references"],
  queryFn: buildReferenceIndex,
  staleTime: 5 * 60 * 1000,
};

/** How a reference reads wherever one is shown. */
export function describeReference({ collection, entryId, where }: AssetReference): string {
  return `${collection} / ${entryId} (${where})`;
}

/** What reaches one file, reusing the index the media page may already have built. */
async function assetReferences(path: string): Promise<AssetReference[]> {
  const index = await queryClient.fetchQuery(REFERENCES_QUERY);

  return index.get(path) ?? [];
}

/**
 * A file may only be removed or moved once nothing points at it. Reported as a
 * diagnostic like every other content check, which is what lets the admin warn a
 * human and the assistant refuse outright from the same result.
 */
export async function validateNoReferences(path: string): Promise<Diagnostic[]> {
  const references = await assetReferences(path);

  return references.length === 0
    ? []
    : [
        diagnostic(
          `"${path}" is still referenced by ${references.length} entries: ${references.map(describeReference).join(", ")}. Update them first.`,
        ),
      ];
}
