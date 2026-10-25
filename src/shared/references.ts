/**
 * What the reference scan produces and how the admin reads it. The index is
 * built on the server (see `server/references.ts`) and travels as JSON, so it is
 * a list of pairs rather than a Map; everything derived from it is a pure
 * function and lives here, where both sides can reach it.
 */
import { z } from "zod";
import type { MediaLibraryId, MediaLocation } from "./media.ts";

/** A reference an entry holds. */
export const assetReferenceSchema = z.object({
  collection: z.string(),
  entryId: z.string(),
  /** The field or prop holding it, or the body it was found in. */
  where: z.string(),
  /** False when only a textual match backs it, e.g. a markdown image. */
  declared: z.boolean(),
});

export type AssetReference = z.infer<typeof assetReferenceSchema>;

/** Library and path, as one key. */
export const fileKey = (library: MediaLibraryId, path: string): string => `${library}:${path}`;

/** One library file and everything that reaches it. */
export interface IndexedFile extends MediaLocation {
  references: AssetReference[];
}

/** Every library file content reaches, across both libraries. */
export type ReferenceIndex = IndexedFile[];

/** The paths of one library that content reaches. */
export const referencedPaths = (index: ReferenceIndex, library: MediaLibraryId): Set<string> =>
  new Set(index.filter((file) => file.library === library).map((file) => file.path));

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
      references.flatMap((r) => (r.declared ? [{ ...r, path }] : [])),
    );
}

/** How a reference reads wherever one is shown. */
export function describeReference(reference: AssetReference): string {
  return `${reference.collection} / ${reference.entryId} (${reference.where})`;
}

/** What reaches one file, from an index the caller already has. */
export function referencesFor(
  index: ReferenceIndex,
  { library, path }: MediaLocation,
): AssetReference[] {
  return index.find((file) => file.library === library && file.path === path)?.references ?? [];
}
