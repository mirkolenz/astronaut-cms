import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { call } from "@client/lib/api";
import { REFERENCES_QUERY } from "@client/queries/use-media";
import type { EntryContent, SaveEntryRequest } from "@shared/types";

const entryKey = (collection: string, id?: string) =>
  id === undefined ? ["cms", "entry", collection] : ["cms", "entry", collection, id];

// Every write changes both what the publish bar reports and what the pending
// changeset contains, so the two always refresh together.
function invalidateStatus(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["cms", "branch-status"] });
  void qc.invalidateQueries({ queryKey: ["cms", "changes"] });
}

/**
 * Everything a write to a collection ages, in one place so no mutation decides
 * for itself: the listing, the entries (in a file collection they share one
 * container, so a write to any of them moves the version the rest are holding),
 * the container's own record, what content references, and the changeset.
 *
 * A version is only worth carrying if it is never left behind, so the set is
 * deliberately one set. Choosing per mutation is how the container version
 * survived a reorder, and the next reorder was then refused as stale.
 */
function invalidateWrite(qc: QueryClient, collection: string) {
  void qc.invalidateQueries({ queryKey: ["cms", "entries", collection] });
  void qc.invalidateQueries({ queryKey: entryKey(collection) });
  void qc.invalidateQueries({ queryKey: ["cms", "file-layout", collection] });
  // What content references is derived from entries, so it ages with them.
  void qc.invalidateQueries({ queryKey: REFERENCES_QUERY.queryKey });
  invalidateStatus(qc);
}

export function useEntries(collection: string) {
  return useQuery({
    queryKey: ["cms", "entries", collection],
    queryFn: () => call("listEntries", { collection }),
    enabled: !!collection,
  });
}

export function useEntry(collection: string, id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: entryKey(collection, id),
    queryFn: () => call("getEntry", { collection, id }),
    enabled: (options?.enabled ?? true) && !!collection && !!id,
  });
}

export function useSaveEntry(collection: string, id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entry: SaveEntryRequest) => call("saveEntry", { collection, id, entry }),
    // A save creates the entry when it is the first one, so the listing refreshes too.
    onSuccess: ({ version }) => {
      // Before the invalidation, so the editor holds the version its next save
      // has to carry even while the refetch is still in flight. Without it a
      // second save inside that window would look stale and be refused.
      if (version) {
        queryClient.setQueryData(
          entryKey(collection, id),
          (current: EntryContent | undefined) => current && { ...current, version },
        );
      }

      invalidateWrite(queryClient, collection);
    },
  });
}

export function useDeleteEntry(collection: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion?: string }) =>
      call("deleteEntry", { collection, id, expectedVersion }),
    onSuccess: () => invalidateWrite(queryClient, collection),
  });
}

export function useRenameEntry(collection: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      oldId,
      newId,
      expectedVersion,
    }: {
      oldId: string;
      newId: string;
      expectedVersion?: string;
    }) => call("renameEntry", { collection, id: oldId, newId, expectedVersion }),
    onSuccess: () => invalidateWrite(queryClient, collection),
  });
}

export function useDuplicateEntry(collection: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sourceId, newId }: { sourceId: string; newId: string }) =>
      call("duplicateEntry", { collection, id: sourceId, newId }),
    onSuccess: () => invalidateWrite(queryClient, collection),
  });
}

/**
 * The container's layout and version. Not `Infinity` any more: the version moves
 * with every write to the file, and it is what the next reorder is based on.
 */
export function useFileLayout(collection: string) {
  return useQuery({
    queryKey: ["cms", "file-layout", collection],
    queryFn: () => call("getFileLayout", { collection }),
    enabled: !!collection,
  });
}

export function useReorderFileEntries(collection: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, expectedVersion }: { ids: string[]; expectedVersion?: string }) =>
      call("reorderEntries", { collection, ids, expectedVersion }),
    onSuccess: () => invalidateWrite(queryClient, collection),
  });
}

// Both of these are invalidated exactly by every write, so the only thing a
// short window buys is a refetch on navigation — and they are the two most
// expensive reads the CMS makes. Not `Infinity`, because `behind` also moves
// when somebody else pushes to the default branch, which nothing here can know.
const CHANGESET_STALE_TIME = 30_000;

export function useBranchStatus() {
  return useQuery({
    queryKey: ["cms", "branch-status"],
    queryFn: () => call("getStatus", {}),
    staleTime: CHANGESET_STALE_TIME,
  });
}

/**
 * The pending changeset: everything written since the last publish, whoever
 * wrote it. The agent invalidates after each write tool, so this refreshes on
 * its own while a session runs.
 */
export function useChanges() {
  return useQuery({
    queryKey: ["cms", "changes"],
    queryFn: () => call("getChanges", {}),
    staleTime: CHANGESET_STALE_TIME,
  });
}

export function usePublish() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => call("publish", {}),
    onSuccess: () => invalidateStatus(queryClient),
  });
}

export function useUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => call("update", {}),
    // The default branch may bring in new content, so everything CMS-related ages.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms"] }),
  });
}

export function useDiscard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => call("discard", {}),
    // Discarding wipes the draft branch: any cached entry on it is stale.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms"] }),
  });
}
