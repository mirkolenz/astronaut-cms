import { useEffect, useState } from "react";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import config from "@/client/lib/config";
import { mediaPath, type MediaLibraryId, type MediaLocation } from "@/shared/media";
import type { AssetReference } from "@/shared/references";
import { call } from "@/client/lib/api";
import { cmsKeys } from "@/client/lib/query-keys";
import { mediaUrl, uploadMedia } from "@/client/lib/media";
import { useEntryContext } from "@/client/lib/entry-context";

/**
 * The reference scan. Derived from entries, not from the library, so it
 * deliberately sits outside the media key that every upload and delete
 * invalidates, and it reads every entry, so nothing fetches it eagerly.
 */
const referencesQuery = queryOptions({
  queryKey: cmsKeys.references,
  queryFn: () => call("getReferences", {}),
  staleTime: 5 * 60 * 1000,
});

export const mediaQuery = (library: MediaLibraryId) =>
  queryOptions({
    queryKey: cmsKeys.media(library),
    queryFn: () => call("listMedia", { library }),
  });

export function useMedia(library: MediaLibraryId) {
  return useQuery(mediaQuery(library));
}

// What a library write ages is stated once per operation in `lib/query-keys.ts`
// and applied by `call`; the upload is the one write that does not finish inside
// an operation, so `uploadMedia` invalidates for itself.

/**
 * A media removal or move carries the references the editor reviewed. The
 * server checks that those references are still current before writing.
 */
export function useDeleteMedia() {
  return useMutation({
    mutationFn: (input: MediaLocation & { acknowledgedReferences: AssetReference[] }) =>
      call("deleteMedia", input),
  });
}

export function useRenameMedia() {
  return useMutation({
    mutationFn: (input: {
      library: MediaLibraryId;
      from: string;
      to: string;
      acknowledgedReferences: AssetReference[];
    }) => call("renameMedia", input),
  });
}

/**
 * What a restore could bring back. Empty for a repository library, whose
 * deletions git keeps, so the media view can ask without knowing which backend
 * it is talking to.
 */
export const trashQuery = (library: MediaLibraryId) =>
  queryOptions({
    queryKey: cmsKeys.trash(library),
    queryFn: () => call("listTrash", { library }),
  });

export function useTrash(library: MediaLibraryId) {
  return useQuery(trashQuery(library));
}

type TrashInput = { library: MediaLibraryId; id: string };

export function useRestoreMedia() {
  return useMutation({ mutationFn: (input: TrashInput) => call("restoreMedia", input) });
}

export function usePurgeTrash() {
  return useMutation({ mutationFn: (input: TrashInput) => call("purgeTrash", input) });
}

/** Uploads a file. `overwrite` is what allows it to replace one already at its path. */
export function useUploadMedia() {
  return useMutation({
    mutationFn: ({
      file,
      overwrite,
      ...location
    }: MediaLocation & { file: File; overwrite?: boolean }) =>
      uploadMedia(location, file, overwrite),
  });
}

const SETTLE_DELAY = 400;

/** Waits for typing to stop, since every distinct value would load a new image. */
function useSettled<T>(value: T): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SETTLE_DELAY);

    return () => clearTimeout(timer);
  }, [value]);

  return settled;
}

/**
 * The URL for an asset reference as content stores it, resolved against the
 * entry it is written in, the same base entry validation and the render-time
 * resolver use, so the preview shows exactly what the site will.
 *
 * The reference is an editable text field, so it settles first: every keystroke
 * would otherwise start an image load for a prefix of the path being typed.
 */
export function useAssetUrl(ref: string | undefined): string | undefined {
  const entryFile = useEntryContext();
  const settled = useSettled(ref);

  if (!settled) return undefined;

  const location = mediaPath(settled, config.media, entryFile);

  return location == null ? undefined : mediaUrl(location);
}

/**
 * The reference index, and the one thing every caller needs to know about it:
 * whether it has been asked for yet. A disabled query reports `isPending`, so
 * "not scanned" and "scanning" are told apart here rather than at each use.
 */
export function useReferenceIndex() {
  const [requested, setRequested] = useState(false);
  const { data, isFetching, error, refetch } = useQuery({
    ...referencesQuery,
    enabled: requested,
  });

  return {
    index: data,
    /** A scan is in flight, which is what the trigger and the empty state react to. */
    scanning: isFetching,
    /** Nothing can be said about references yet, whether or not a scan is running. */
    pending: isFetching || data == null,
    error,
    /** Always rescans, joining a scan already in flight rather than restarting it. */
    scan: () => {
      setRequested(true);
      void refetch({ cancelRefetch: false });
    },
  };
}
