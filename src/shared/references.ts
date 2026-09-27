/**
 * What the reference scan produces and how the admin reads it. The index is
 * built on the server (see `server/references.ts`) and travels as JSON, so it is
 * a list of pairs rather than a Map; everything derived from it is a pure
 * function and lives here, where both sides can reach it.
 */
import { matchesGlob } from "pathe";
import type { ClientMediaConfig, MediaLibraryId, MediaLocation } from "./media.ts";

export interface AssetReference {
  collection: string;
  entryId: string;
  /** The field or prop holding it, or the body it was found in. */
  where: string;
  /** False when only a textual match backs it, e.g. a markdown image. */
  declared: boolean;
}

/** One library file and everything that reaches it. */
export interface IndexedFile extends MediaLocation {
  references: AssetReference[];
}

/** Every library file content reaches, across both libraries. */
export type ReferenceIndex = IndexedFile[];

/**
 * What a file is, as far as anything can tell: reached by content, kept by
 * `media.repo.alwaysInclude` although nothing references it, or reached by
 * nothing at all. Every kind of evidence counts as `used`, textual included, the
 * question is whether deleting the file is safe, and a maybe is enough to say no.
 */
export type Usage = "used" | "always-included" | "orphan";

/** The paths of one library that content reaches. */
const referencedIn = (index: ReferenceIndex, library: MediaLibraryId): Set<string> =>
  new Set(index.filter((file) => file.library === library).map((file) => file.path));

export function classifyUsage(
  library: MediaLibraryId,
  paths: string[],
  index: ReferenceIndex,
  media: ClientMediaConfig,
): Map<string, Usage> {
  const referenced = referencedIn(index, library);

  return new Map(
    paths.map((path) => [
      path,
      referenced.has(path)
        ? "used"
        : library === "repo" && alwaysIncluded(path, media)
          ? "always-included"
          : "orphan",
    ]),
  );
}

/**
 * Whether the build keeps a file no content references. Only the repository
 * library is bundled, so `alwaysInclude` says nothing about the object store.
 * `matchesGlob` is the same matcher the build globs with, so the two cannot
 * disagree about which files the option covers.
 */
function alwaysIncluded(path: string, media: ClientMediaConfig): boolean {
  return media.repo.alwaysInclude.some((pattern) => matchesGlob(path, pattern));
}

/** A reference to a file the library does not hold. */
export interface StaleReference extends AssetReference {
  path: string;
}

/**
 * References into one library pointing at nothing. Only schema-declared ones are
 * reported: a textual match is good enough to stop a deletion but not to accuse
 * an entry of being broken, since prose can hold a path-shaped string that names
 * no asset.
 *
 * With the repository library the build catches these, with an object store
 * nothing else does, which is why the admin reports them.
 */
export function staleReferences(
  index: ReferenceIndex,
  library: MediaLibraryId,
  paths: string[],
): StaleReference[] {
  const existing = new Set(paths);

  return index
    .filter((file) => file.library === library && !existing.has(file.path))
    .flatMap(({ path, references }) =>
      references.filter((r) => r.declared).map((reference) => ({ ...reference, path })),
    );
}

/** How a reference reads wherever one is shown. */
export function describeReference({ collection, entryId, where }: AssetReference): string {
  return `${collection} / ${entryId} (${where})`;
}

/** What reaches one file, from an index the caller already has. */
export function referencesFor(index: ReferenceIndex, { library, path }: MediaLocation): AssetReference[] {
  return index.find((file) => file.library === library && file.path === path)?.references ?? [];
}
