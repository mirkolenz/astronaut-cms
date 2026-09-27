import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import config from "virtual:astronaut-cms/config";
import { mediaPath } from "@shared/media";
import { getMedia } from "@client/lib/media";
import { useEntryContext } from "@client/lib/entry-context";
import { REFERENCES_QUERY } from "@client/lib/media/references";

export const MEDIA_KEY = ["cms", "media"];

export function useMedia() {
  return useQuery({
    queryKey: MEDIA_KEY,
    queryFn: () => getMedia().listMedia(),
  });
}

function useMediaMutation<T>(mutationFn: (variables: T) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MEDIA_KEY }),
  });
}

export function useDeleteMedia() {
  return useMediaMutation((path: string) => getMedia().deleteMedia(path));
}

/** Uploads a file. `overwrite` is what allows it to replace one already at `path`. */
export function useUploadMedia() {
  return useMediaMutation(
    ({ path, file, overwrite }: { path: string; file: File; overwrite?: boolean }) =>
      getMedia().uploadMedia(path, file, overwrite),
  );
}

export function useRenameMedia() {
  return useMediaMutation(({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
    getMedia().renameMedia(oldPath, newPath),
  );
}

/**
 * A resolved URL is not permanently valid: GitHub's `download_url` carries a
 * short-lived token for a private repository, so it is re-resolved well before
 * that expires rather than cached for the life of the session.
 */
const URL_TTL = 4 * 60 * 1000;

/**
 * Resolved once per path and cached: a repository backend pays an API call for
 * each. A backend that can only hand over bytes returns a Blob, and the object
 * URL wrapping it is created and revoked here, where its lifetime is known.
 */
export function useMediaUrl(path: string | null | undefined): string | undefined {
  const { data } = useQuery({
    // Outside MEDIA_KEY: a listing change must not throw away resolved URLs.
    queryKey: ["cms", "media-url", path],
    queryFn: () => getMedia().readUrl(path!),
    enabled: path != null,
    staleTime: URL_TTL,
    retry: false,
  });
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!(data instanceof Blob)) return;

    const url = URL.createObjectURL(data);

    setObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [data]);

  return data instanceof Blob ? objectUrl : data;
}

const SETTLE_DELAY = 400;

/** Waits for typing to stop, since every distinct value costs the backend a request. */
function useSettled<T>(value: T): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SETTLE_DELAY);

    return () => clearTimeout(timer);
  }, [value]);

  return settled;
}

/**
 * The same, for an asset reference as content stores it. The reference is an
 * editable text field, so it settles first: resolving every keystroke would
 * spend a Git API call on each prefix of the path being typed.
 *
 * A relative reference is resolved against the entry it is written in, the same
 * base entry validation and the render-time resolver use, so the preview shows
 * exactly what the site will.
 */
export function useAssetUrl(ref: string | undefined) {
  const entry = useEntryContext();
  const settled = useSettled(ref);

  return useMediaUrl(settled ? mediaPath(settled, config, entry?.contentFilePath) : null);
}

/**
 * The reference index, built by reading every entry, so it is only fetched when
 * something actually asks (the unused filter, or a delete about to happen). And
 * the one thing every caller needs to know about it:
 * whether it has been asked for yet. A disabled query reports `isPending`, so
 * "not scanned" and "scanning" are told apart here rather than at each use.
 */
export function useReferenceIndex() {
  const [requested, setRequested] = useState(false);
  const { data, isFetching, error } = useQuery({ ...REFERENCES_QUERY, enabled: requested });

  return {
    index: data,
    /** A scan is in flight, which is what the trigger and the empty state react to. */
    scanning: isFetching,
    /** Nothing can be said about references yet, whether or not a scan is running. */
    pending: isFetching || data == null,
    error,
    scan: () => setRequested(true),
  };
}
