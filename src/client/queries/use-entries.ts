import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { call } from "@client/lib/api";
import { REFERENCES_QUERY } from "@client/queries/use-media";
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
    queryFn: () => call("listEntries", { collection }),
    enabled: !!collection,
  });
}

export function useEntry(collection: string, id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["cms", "entry", collection, id],
    queryFn: () => call("getEntry", { collection, id }),
    enabled: (options?.enabled ?? true) && !!collection && !!id,
  });
}

export function useSaveEntry(collection: string, id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entry: SaveEntryRequest) => call("saveEntry", { collection, id, entry }),
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
    mutationFn: (id: string) => call("deleteEntry", { collection, id }),
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
      call("renameEntry", { collection, id: oldId, newId }),
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
      call("duplicateEntry", { collection, id: sourceId, newId }),
    onSuccess: () => {
      invalidateEntries(queryClient, collection);
      invalidateStatus(queryClient);
    },
  });
}

export function useFileLayout(collection: string) {
  return useQuery({
    queryKey: ["cms", "file-layout", collection],
    queryFn: () => call("getFileLayout", { collection }),
    staleTime: Infinity,
    enabled: !!collection,
  });
}

export function useReorderFileEntries(collection: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => call("reorderEntries", { collection, ids }),
    onSuccess: () => {
      invalidateEntries(queryClient, collection);
      invalidateStatus(queryClient);
    },
  });
}

export function useBranchStatus() {
  return useQuery({
    queryKey: ["cms", "branch-status"],
    queryFn: () => call("getStatus", {}),
    staleTime: 5_000,
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
    staleTime: 5_000,
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
