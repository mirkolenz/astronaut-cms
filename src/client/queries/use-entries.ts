import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getStorage } from "@client/lib/storage";
import type { BranchStatus } from "@client/lib/storage/types";
import { fetchJson } from "@client/lib/api";
import type { SaveEntryRequest } from "@shared/types";

function invalidateEntries(qc: QueryClient, collection: string) {
  void qc.invalidateQueries({ queryKey: ["cms", "entries", collection] });
}

function invalidateEntry(qc: QueryClient, collection: string, id: string) {
  void qc.invalidateQueries({ queryKey: ["cms", "entry", collection, id] });
}

function invalidateBranchStatus(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["cms", "branch-status"] });
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
    onSuccess: () => {
      invalidateEntry(queryClient, collection, id);
      invalidateBranchStatus(queryClient);
    },
  });
}

export function useCreateEntry(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, format }: { id: string; format: string }) =>
      getStorage().saveEntry(collection, id, { data: {}, body: "", format }),
    onSuccess: () => {
      invalidateEntries(queryClient, collection);
      invalidateBranchStatus(queryClient);
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
      invalidateBranchStatus(queryClient);
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
      invalidateBranchStatus(queryClient);
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
      invalidateBranchStatus(queryClient);
    },
  });
}

export function useFileLayout(collection: string) {
  return useQuery({
    queryKey: ["cms", "file-layout", collection],
    queryFn: async () => {
      try {
        const data = await fetchJson<{ layout: "array" | "object" }>(
          `/entries/${collection}/_layout`,
        );
        return data.layout;
      } catch {
        return "object" as const;
      }
    },
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
      invalidateBranchStatus(queryClient);
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

export function usePublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => getStorage().publish(),
    onSuccess: () => {
      invalidateBranchStatus(queryClient);
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
