import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getStorage } from "@client/lib/storage";
import { REFERENCES_QUERY } from "@client/lib/media/references";
import type { BranchStatus } from "@client/lib/storage/types";
import type { FileChange } from "@shared/types";
import type { SaveEntryRequest } from "@shared/types";

function invalidateEntries(qc: QueryClient, collection: string) {
  void qc.invalidateQueries({ queryKey: ["cms", "entries", collection] });
  // What content references is derived from entries, so it ages with them.
  void qc.invalidateQueries({ queryKey: REFERENCES_QUERY.queryKey });
}

function invalidateEntry(qc: QueryClient, collection: string, id: string) {
  void qc.invalidateQueries({ queryKey: ["cms", "entry", collection, id] });
}

// Every write changes both what the publish bar reports and what the pending
// changeset contains, so the two always refresh together.
function invalidateStatus(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["cms", "branch-status"] });
  void qc.invalidateQueries({ queryKey: ["cms", "changes"] });
}

export function useEntries(collection: string) {
  return useQuery({
    queryKey: ["cms", "entries", collection],
    queryFn: () => getStorage().listEntries(collection),
    enabled: !!collection,
  });
}

export function useEntry(collection: string, id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["cms", "entry", collection, id],
    queryFn: () => getStorage().getEntry(collection, id),
    enabled: (options?.enabled ?? true) && !!collection && !!id,
  });
}

export function useSaveEntry(collection: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveEntryRequest) => getStorage().saveEntry(collection, id, data),
    // A save creates the entry when it is the first one, so the listing refreshes too.
    onSuccess: () => {
      invalidateEntries(queryClient, collection);
      invalidateEntry(queryClient, collection, id);
      invalidateStatus(queryClient);
    },
  });
}

export function useDeleteEntry(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getStorage().deleteEntry(collection, id),
    onSuccess: (_, id) => {
      invalidateEntries(queryClient, collection);
      invalidateEntry(queryClient, collection, id);
      invalidateStatus(queryClient);
    },
  });
}

export function useRenameEntry(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ oldId, newId }: { oldId: string; newId: string }) =>
      getStorage().renameEntry(collection, oldId, newId),
    onSuccess: (_, { oldId }) => {
      invalidateEntries(queryClient, collection);
      invalidateEntry(queryClient, collection, oldId);
      invalidateStatus(queryClient);
    },
  });
}

export function useDuplicateEntry(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, newId }: { sourceId: string; newId: string }) =>
      getStorage().duplicateEntry(collection, sourceId, newId),
    onSuccess: () => {
      invalidateEntries(queryClient, collection);
      invalidateStatus(queryClient);
    },
  });
}

export function useFileLayout(collection: string) {
  return useQuery({
    queryKey: ["cms", "file-layout", collection],
    queryFn: () => getStorage().getFileLayout(collection),
    staleTime: Infinity,
    enabled: !!collection,
  });
}

export function useReorderFileEntries(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => getStorage().reorderEntries(collection, ids),
    onSuccess: () => {
      invalidateEntries(queryClient, collection);
      invalidateStatus(queryClient);
    },
  });
}

export function useBranchStatus() {
  return useQuery<BranchStatus>({
    queryKey: ["cms", "branch-status"],
    queryFn: () => getStorage().getStatus(),
    staleTime: 5_000,
  });
}

/**
 * The pending changeset: everything written since the last publish, whoever
 * wrote it. The agent invalidates after each write tool, so this refreshes on
 * its own while a session runs.
 */
export function useChanges() {
  return useQuery<FileChange[]>({
    queryKey: ["cms", "changes"],
    queryFn: () => getStorage().getChanges(),
    staleTime: 5_000,
  });
}

export function usePublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => getStorage().publish(),
    onSuccess: () => {
      invalidateStatus(queryClient);
    },
  });
}

export function useUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => getStorage().update(),
    // Default branch may bring in new content — invalidate everything CMS-related.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cms"] });
    },
  });
}

export function useDiscard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => getStorage().discard(),
    // Discarding wipes the user's branch — any cached entries on it are stale.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cms"] });
    },
  });
}
