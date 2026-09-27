import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import config from "virtual:astronaut-cms/config";
import { mediaPath } from "@shared/media";
import type { ReferenceIndex } from "@shared/references";
import { call } from "@client/lib/api";
import { mediaUrl, uploadMedia } from "@client/lib/media";
import { useEntryContext } from "@client/lib/entry-context";

export const MEDIA_KEY = ["cms", "media"];
export const TRASH_KEY = ["cms", "trash"];

/**
 * The reference scan. Derived from entries, not from the library, so it
 * deliberately sits outside the media key that every upload and delete
 * invalidates — and it reads every entry, so nothing fetches it eagerly.
 */
export const REFERENCES_QUERY = {
  queryKey: ["cms", "references"],
  queryFn: () => call("getReferences", {}),
  staleTime: 5 * 60 * 1000,
};

export function useMedia() {
  return useQuery({ queryKey: MEDIA_KEY, queryFn: () => call("listMedia", {}) });
}

/**
 * Every media write moves a file between the library and the trash, so the two
 * lists go stale together. The reference index deliberately stays out of it (see
 * `REFERENCES_QUERY`), since it is derived from entries and costs a full scan.
 */
function useMediaMutation<T>(mutationFn: (variables: T) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MEDIA_KEY });
      await queryClient.invalidateQueries({ queryKey: TRASH_KEY });
    },
  });
}

/**
 * `force` is how a human says they have seen what references the file. The
 * server refuses a referenced path without it, which is what stops anything that
 * has *not* seen them — the assistant above all — from deleting one.
 */
export function useDeleteMedia() {
  return useMediaMutation(({ path, force }: { path: string; force?: boolean }) =>
    call("deleteMedia", { path, force }),
  );
}

export function useRenameMedia() {
  return useMediaMutation(({ oldPath, newPath, force }: { oldPath: string; newPath: string; force?: boolean }) =>
    call("renameMedia", { from: oldPath, to: newPath, force }),
  );
}

/**
 * What a restore could bring back. Empty for a repository library, whose
 * deletions git keeps, so the media view can ask without knowing which backend
 * it is talking to.
 */
export function useTrash() {
  return useQuery({ queryKey: TRASH_KEY, queryFn: () => call("listTrash", {}) });
}

export function useRestoreMedia() {
  return useMediaMutation(({ id }: { id: string }) => call("restoreMedia", { id }));
}

export function usePurgeTrash() {
  return useMediaMutation(({ id }: { id: string }) => call("purgeTrash", { id }));
}

/** Uploads a file. `overwrite` is what allows it to replace one already at `path`. */
export function useUploadMedia() {
  return useMediaMutation(({ path, file, overwrite }: { path: string; file: File; overwrite?: boolean }) =>
    uploadMedia(path, file, overwrite),
  );
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
 * entry it is written in — the same base entry validation and the render-time
 * resolver use, so the preview shows exactly what the site will.
 *
 * The reference is an editable text field, so it settles first: every keystroke
 * would otherwise start an image load for a prefix of the path being typed.
 */
export function useAssetUrl(ref: string | undefined): string | undefined {
  const entry = useEntryContext();
  const settled = useSettled(ref);

  if (!settled) return undefined;

  const path = mediaPath(settled, config, entry?.contentFilePath);

  return path == null ? undefined : mediaUrl(path);
}

/**
 * The reference index, and the one thing every caller needs to know about it:
 * whether it has been asked for yet. A disabled query reports `isPending`, so
 * "not scanned" and "scanning" are told apart here rather than at each use.
 */
export function useReferenceIndex() {
  const [requested, setRequested] = useState(false);
  const { data, isFetching, error } = useQuery({ ...REFERENCES_QUERY, enabled: requested });

  return {
    index: data as ReferenceIndex | undefined,
    /** A scan is in flight, which is what the trigger and the empty state react to. */
    scanning: isFetching,
    /** Nothing can be said about references yet, whether or not a scan is running. */
    pending: isFetching || data == null,
    error,
    scan: () => setRequested(true),
  };
}
