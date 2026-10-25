/**
 * Every CMS query key, and what each operation ages.
 *
 * Invalidation used to sit on the mutation hooks, which meant a write that did
 * not go through one left the open admin showing content it had itself
 * replaced. The assistant worked around it by invalidating everything after
 * each of its tool calls, and an agent arriving over WebMCP would have had
 * nothing at all. Stating it per operation puts it where the write is: one
 * place decides, and every caller of `call` inherits it, surgically.
 */
import type { OperationInput, OperationName } from "@/server/operations";
import config from "@/client/lib/config";
import { queryClient } from "@/client/lib/query-client";
import { isTransactionalMedia, type MediaLibraryId } from "@/shared/media";

export type QueryKey = readonly unknown[];

const root = ["cms"] as const;

export const cmsKeys = {
  /** Everything the CMS caches, for the writes that age all of it. */
  all: root,
  entries: (collection: string) => [...root, "entries", collection],
  /** Without an id: every entry of the collection. */
  entry: (collection: string, id?: string) =>
    id === undefined ? [...root, "entry", collection] : [...root, "entry", collection, id],
  fileLayout: (collection: string) => [...root, "file-layout", collection],
  branchStatus: [...root, "branch-status"],
  changes: [...root, "changes"],
  media: (library: MediaLibraryId) => [...root, "media", library],
  trash: (library: MediaLibraryId) => [...root, "trash", library],
  references: [...root, "references"],
} as const;

/** What the publish bar reports and what the changeset holds, which move together. */
const CHANGESET: QueryKey[] = [cmsKeys.branchStatus, cmsKeys.changes];

/**
 * A library write moves the two lists a file can be in, and, only where the
 * library is part of the repository, the changeset it joins. A live object
 * store is not a backend the CMS commits to, so nothing pending moves there.
 *
 * Read when the write happens rather than at module scope: the config is
 * delivered at runtime, and a library write is rare enough that the array costs
 * nothing (a collection write, which is not, names a constant).
 */
const mediaWrite = ({ library }: { library: MediaLibraryId }): QueryKey[] => [
  cmsKeys.media(library),
  cmsKeys.trash(library),
  ...(isTransactionalMedia(config.media, library) ? CHANGESET : []),
];

/**
 * Everything a write to a collection ages: the listing, the entries (in a file
 * collection they share one container, so a write to any of them moves the
 * version the rest are holding), the container's own record, what content
 * references, and the changeset.
 *
 * A version is only worth carrying if it is never left behind, so the set is
 * deliberately one set. Choosing per operation is how the container version
 * survived a reorder, and the next reorder was then refused as stale.
 */
const collectionWrite = ({ collection }: { collection: string }): QueryKey[] => [
  cmsKeys.entries(collection),
  cmsKeys.entry(collection),
  cmsKeys.fileLayout(collection),
  // What content references is derived from entries, so it ages with them.
  cmsKeys.references,
  ...CHANGESET,
];

/**
 * Total over the write operations, which is what the tests pin: an operation
 * missing from here is a write that leaves the admin showing what it replaced,
 * and an empty list is that decision made deliberately.
 */
export const INVALIDATIONS: { [K in OperationName]?: (input: OperationInput<K>) => QueryKey[] } = {
  saveEntry: collectionWrite,
  deleteEntry: collectionWrite,
  renameEntry: collectionWrite,
  duplicateEntry: collectionWrite,
  reorderEntries: collectionWrite,
  publish: () => CHANGESET,
  // The default branch brings in content nothing here has seen, and a discard
  // wipes the draft branch: either way every cached answer is from a tree that
  // no longer exists.
  update: () => [cmsKeys.all],
  discard: () => [cmsKeys.all],
  renameMedia: mediaWrite,
  deleteMedia: mediaWrite,
  restoreMedia: mediaWrite,
  purgeTrash: mediaWrite,
  // Hands out a ticket; the bytes land afterwards, so `uploadMedia` is what ages
  // the library once they have.
  beginUpload: () => [],
};

/** What a completed operation aged. A read ages nothing. */
export function keysFor<K extends OperationName>(op: K, input: OperationInput<K>): QueryKey[] {
  return INVALIDATIONS[op]?.(input) ?? [];
}

/**
 * Ages the given keys, each one once. A batch of writes to the same collection
 * names the same handful of keys over and over, and every `invalidateQueries`
 * is a full walk of the query cache.
 */
export function invalidate(keys: readonly QueryKey[]): void {
  for (const queryKey of new Map(keys.map((key) => [JSON.stringify(key), key])).values()) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** What an upload ages, once the bytes have actually landed. */
export const invalidateMedia = (library: MediaLibraryId): void =>
  invalidate(mediaWrite({ library }));
