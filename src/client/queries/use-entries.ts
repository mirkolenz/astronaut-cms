import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "@client/lib/api";
import { cmsKeys } from "@client/lib/query-keys";
import type { EntryContent, SaveEntryRequest } from "@shared/types";

// None of these mutations invalidates anything: what a write ages is stated once
// per operation in `lib/query-keys.ts` and applied by `call` itself, so the
// assistant and any agent reaching the same operations get it too.

export function useEntries(collection: string) {
  return useQuery({
    queryKey: cmsKeys.entries(collection),
    queryFn: () => call("listEntries", { collection }),
    enabled: !!collection,
  });
}

export function useEntry(collection: string, id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: cmsKeys.entry(collection, id),
    queryFn: () => call("getEntry", { collection, id }),
    enabled: (options?.enabled ?? true) && !!collection && !!id,
  });
}

export function useSaveEntry(collection: string, id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entry: SaveEntryRequest) => call("saveEntry", { collection, id, entry }),
    // The refetch the save triggered is still in flight, so the editor is given
    // the version its next save has to carry directly. Without it a second save
    // inside that window would look stale and be refused.
    onSuccess: ({ version }) => {
      if (version) {
        queryClient.setQueryData(
          cmsKeys.entry(collection, id),
          (current: EntryContent | undefined) => current && { ...current, version },
        );
      }
    },
  });
}

export function useDeleteEntry(collection: string) {
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion?: string }) =>
      call("deleteEntry", { collection, id, expectedVersion }),
  });
}

export function useRenameEntry(collection: string) {
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
  });
}

export function useDuplicateEntry(collection: string) {
  return useMutation({
    mutationFn: ({ sourceId, newId }: { sourceId: string; newId: string }) =>
      call("duplicateEntry", { collection, id: sourceId, newId }),
  });
}

/**
 * The container's layout and version. Not `Infinity` any more: the version moves
 * with every write to the file, and it is what the next reorder is based on.
 */
export function useFileLayout(collection: string) {
  return useQuery({
    queryKey: cmsKeys.fileLayout(collection),
    queryFn: () => call("getFileLayout", { collection }),
    enabled: !!collection,
  });
}

export function useReorderFileEntries(collection: string) {
  return useMutation({
    mutationFn: ({ ids, expectedVersion }: { ids: string[]; expectedVersion?: string }) =>
      call("reorderEntries", { collection, ids, expectedVersion }),
  });
}

// Both of these are invalidated exactly by every write, so the only thing a
// short window buys is a refetch on navigation — and they are the two most
// expensive reads the CMS makes. Not `Infinity`, because `behind` also moves
// when somebody else pushes to the default branch, which nothing here can know.
const CHANGESET_STALE_TIME = 30_000;

export function useBranchStatus() {
  return useQuery({
    queryKey: cmsKeys.branchStatus,
    queryFn: () => call("getStatus", {}),
    staleTime: CHANGESET_STALE_TIME,
  });
}

/**
 * The pending changeset: everything written since the last publish, whoever
 * wrote it. Every write ages it, so it refreshes on its own while an agent runs.
 */
export function useChanges() {
  return useQuery({
    queryKey: cmsKeys.changes,
    queryFn: () => call("getChanges", {}),
    staleTime: CHANGESET_STALE_TIME,
  });
}

export function usePublish() {
  return useMutation({ mutationFn: () => call("publish", {}) });
}

export function useUpdate() {
  return useMutation({ mutationFn: () => call("update", {}) });
}

export function useDiscard() {
  return useMutation({ mutationFn: () => call("discard", {}) });
}
