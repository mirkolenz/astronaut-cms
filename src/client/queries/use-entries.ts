import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@/client/lib/storage";
import { parseContent, serializeContent } from "@/shared/content-parser";
import { useChangesStore } from "@/client/stores/changes-store";
import type { SaveEntryRequest } from "@/shared/types";

export function useEntries(collection: string) {
  return useQuery({
    queryKey: ["cms", "entries", collection],
    queryFn: async () => {
      const entries = await getStorage().listEntries(collection);
      const changes = useChangesStore.getState().changes;

      // Filter out pending deletes
      const filtered = entries.filter(
        (e) =>
          !changes.some(
            (c) => c.collection === collection && c.entryId === e.id && c.action === "delete",
          ),
      );

      // Add pending creates not already in the list
      for (const c of changes) {
        if (
          c.collection === collection &&
          c.action === "create" &&
          !entries.some((e) => e.id === c.entryId)
        ) {
          filtered.push({
            id: c.entryId,
            collection,
            slug: c.entryId,
            format: c.format,
          });
        }
      }

      return filtered;
    },
    enabled: !!collection,
  });
}

export function useEntry(collection: string, id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["cms", "entry", collection, id],
    queryFn: async () => {
      // Check for pending changes first
      const changes = useChangesStore.getState().changes;
      const pending = changes.find(
        (c) => c.collection === collection && c.entryId === id && c.action !== "delete",
      );

      if (pending?.content) {
        const { data, body } = parseContent(pending.content, pending.format);
        return { id, data, body, format: pending.format };
      }

      return getStorage().getEntry(collection, id);
    },
    enabled: (options?.enabled ?? true) && !!collection && !!id,
  });
}

export function useSaveEntry(collection: string, id: string) {
  return useMutation({
    mutationFn: (data: SaveEntryRequest) => getStorage().saveEntry(collection, id, data),
  });
}

export function useCreateEntry(collection: string) {
  return useMutation({
    mutationFn: async ({ id, format }: { id: string; format: string }) => {
      const content = serializeContent({}, "", format);
      useChangesStore.getState().addChange({
        collection,
        entryId: id,
        action: "create",
        content,
        format,
        message: `Create ${collection}/${id}`,
      });
    },
  });
}

export function useDeleteEntry(collection: string) {
  return useMutation({
    mutationFn: (id: string) => getStorage().deleteEntry(collection, id),
  });
}

export function useFileLayout(collection: string) {
  return useQuery({
    queryKey: ["cms", "file-layout", collection],
    queryFn: async () => {
      const res = await fetch(`/__cms/entries/${collection}/_layout`);
      if (!res.ok) return "object" as const;
      const data = (await res.json()) as { layout: "array" | "object" };
      return data.layout;
    },
    staleTime: Infinity,
    enabled: !!collection,
  });
}

export function useReorderFileEntries(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(`/__cms/entries/${collection}/_reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`Reorder failed: ${res.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cms", "entries", collection] });
    },
  });
}

export function usePublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => getStorage().publish(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cms"] });
    },
  });
}
