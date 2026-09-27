/**
 * What the reference scan produces and how the admin reads it. The index is
 * built on the server (see `server/references.ts`) and travels as JSON, so it is
 * a list of pairs rather than a Map; everything derived from it is a pure
 * function and lives here, where both sides can reach it.
 */
import { matchesGlob } from "pathe";
import type { CmsClientConfig } from "../integration/types.ts";

export interface AssetReference {
  collection: string;
  entryId: string;
  /** The field or prop holding it, or the body it was found in. */
  where: string;
  /** False when only a textual match backs it, e.g. a markdown image. */
  declared: boolean;
}

/** Library path to everything that reaches it. */
export type ReferenceIndex = Array<[string, AssetReference[]]>;

/**
 * What a file is, as far as anything can tell: reached by content, kept by
 * `media.alwaysInclude` although nothing references it, or reached by nothing at
 * all. Every kind of evidence counts as `used`, textual included — the question
 * is whether deleting the file is safe, and a maybe is enough to say no.
 */
export type Usage = "used" | "always-included" | "orphan";

export function classifyUsage(
  paths: string[],
  index: ReferenceIndex,
  config: CmsClientConfig,
): Map<string, Usage> {
  const referenced = new Set(index.map(([path]) => path));

  return new Map(
    paths.map((path) => [
      path,
      referenced.has(path)
        ? "used"
        : alwaysIncluded(path, config)
          ? "always-included"
          : "orphan",
    ]),
  );
}

/**
 * Whether the build keeps a file no content references. Only a repository
 * library is bundled, so `alwaysInclude` says nothing about an object store.
 * `matchesGlob` is the same matcher the build globs with, so the two cannot
 * disagree about which files the option covers.
 */
function alwaysIncluded(path: string, config: CmsClientConfig): boolean {
  return (
    config.mediaBackend.type === "repo" &&
    config.mediaAlwaysInclude.some((pattern) => matchesGlob(path, pattern))
  );
}

/** A reference to a file the library does not hold. */
export interface StaleReference extends AssetReference {
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

  return index
    .filter(([path]) => !existing.has(path))
    .flatMap(([path, references]) =>
      references.filter((r) => r.declared).map((reference) => ({ ...reference, path })),
    );
}

/** How a reference reads wherever one is shown. */
export function describeReference({ collection, entryId, where }: AssetReference): string {
  return `${collection} / ${entryId} (${where})`;
}

/** What reaches one file, from an index the caller already has. */
export function referencesFor(index: ReferenceIndex, path: string): AssetReference[] {
  return index.find(([key]) => key === path)?.[1] ?? [];
}
