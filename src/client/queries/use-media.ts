import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@client/lib/storage";

export function useMedia() {
  return useQuery({
    queryKey: ["cms", "media"],
    queryFn: () => getStorage().listMedia(),
  });
}

export function useDeleteMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => getStorage().deleteMedia(path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms", "media"] }),
  });
}

export function useUploadMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, file }: { path: string; file: File }) =>
      getStorage().uploadMedia(path, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms", "media"] }),
  });
}

export function useReplaceMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, file }: { path: string; file: File }) =>
      getStorage().replaceMedia(path, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms", "media"] }),
  });
}

export function useRenameMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
      getStorage().renameMedia(oldPath, newPath),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms", "media"] }),
  });
}
