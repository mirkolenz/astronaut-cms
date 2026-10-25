/**
 * The media library from the admin's side: a URL for every file, and the upload
 * that is the one thing here with more than one step.
 *
 * Reading is a plain URL, and where that URL points is settled here rather than
 * by a round trip. A library served from a public base needs no server at all:
 * the key *is* the URL, so a grid of thumbnails costs nothing. Everything else,
 * a repository library or a dev run reading the working tree, goes through
 * `GET .../media/<path>`, which answers with the bytes or redirects to wherever
 * they really live. Either way an `<img>` addresses a library file
 * the same way, with no fetch, no object URL and no lifetime to manage.
 *
 * A proxied URL carries the file's version where the listing knows one, which is
 * what makes a grid of thumbnails cost function invocations once rather than on
 * every visit: the URL changes when the bytes do, so the answer can be cached
 * for good instead of for minutes.
 */
import config from "@/client/lib/config";
// The shared instance `@/client/i18n` initializes, without the browser storage that module reads on import.
import i18n from "i18next";
import { API_MEDIA, API_UPLOAD } from "@/shared/auth";
import {
  encodeKeyPath,
  libraryRefusal,
  mediaLibraries,
  mediaLibrary,
  remoteMediaUrl,
  type MediaLibraryId,
  type MediaLocation,
} from "@/shared/media";
import { call, unwrap } from "@/client/lib/api";
import { invalidateMedia } from "@/client/lib/query-keys";
import { apiFetch, apiUrl } from "@/client/lib/routes";

/** What the admin calls a library: the configured label, or the translated default. */
export function libraryLabel(library: MediaLibraryId): string {
  return mediaLibrary(config.media, library).label ?? i18n.t(($) => $.media.libraries[library]);
}

/**
 * Where the admin loads one library file from. `version` comes from the listing
 * and is what allows the answer to be cached indefinitely; without it the file
 * is still served, just cached for minutes.
 */
export function mediaUrl({ library, path }: MediaLocation, version?: string): string {
  const s3 = library === "s3" ? config.media.s3 : null;
  // A public base is a CDN, and a CDN holds what it was given until it expires:
  // without the version, replacing a file leaves every editor looking at the old
  // one. So the version goes on both kinds of URL, and means the same thing on
  // each — this address is these bytes.
  const url =
    s3 && s3.directory == null
      ? remoteMediaUrl(path, s3.publicUrl)
      : apiUrl(`${API_MEDIA}/${library}/${encodeKeyPath(path)}`);

  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

/** Why a library refuses a file, or null when it takes it. */
export const refusalOf = (library: MediaLibraryId, file: File): string | null =>
  libraryRefusal(mediaLibrary(config.media, library), file.name, file.size);

/** Why a library refuses a file, naming the other library where that one would take it. */
function uploadRefusal(library: MediaLibraryId, file: File): string | null {
  const error = refusalOf(library, file);
  const other =
    error && mediaLibraries(config.media).find((id) => id !== library && !refusalOf(id, file));

  if (!error || !other) return error;

  return `${error} ${i18n.t(($) => $.media.tryLibrary, { library: libraryLabel(other) })}`;
}

/**
 * Uploads a file, straight to an object store or through the server into a
 * repository library, as the server says.
 *
 * The direct route is the object store's: the server signs a URL for this exact file
 * at this exact key, and the browser sends the bytes straight to the store. The
 * bytes never pass through a serverless function, and the library's rules travel
 * with the signature, so the store applies them to the write itself rather than
 * this server having to check afterwards what arrived.
 */
export async function uploadMedia(
  location: MediaLocation,
  file: File,
  overwrite = false,
): Promise<void> {
  // Refused here too, so a file outside the library's bounds is not sent before being rejected.
  const refusal = uploadRefusal(location.library, file);

  if (refusal) throw new Error(refusal);

  const ticket = await call("beginUpload", { ...location, size: file.size, overwrite });

  if (ticket.direct) await putDirect(ticket, location.path, file);
  else await putThroughServer(location, file, overwrite);

  // One exit, so no route can be added that forgets to age the library. The
  // ticket alone does not: the bytes only land here.
  invalidateMedia(location.library);
}
/**
 * Sent verbatim: the terms are signed into the URL, so changing or dropping one
 * makes the store reject the request rather than accept different terms.
 */
async function putDirect(
  ticket: { url: string; headers: Record<string, string> },
  path: string,
  file: File,
): Promise<void> {
  const stored = await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: file });

  // The precondition the server signed into the URL, refused by the store. This
  // is the only report of an occupied destination on the direct path: nothing
  // checked beforehand, because the write itself is the check.
  if (stored.status === 412) {
    throw new Error(
      `A file already exists at "${path}". Use a different name, or replace it deliberately.`,
    );
  }

  if (!stored.ok) throw new Error(`Upload failed (${stored.status}).`);
}

/**
 * Through `unwrap` like every other CMS call: the route answers in the same
 * envelope, so a lapsed session and a refused destination read the same way here
 * as they do everywhere else.
 */
async function putThroughServer(
  { library, path }: MediaLocation,
  file: File,
  overwrite: boolean,
): Promise<void> {
  const query = new URLSearchParams({ library, path, ...(overwrite && { overwrite: "true" }) });

  await unwrap(await apiFetch(apiUrl(`${API_UPLOAD}?${query}`), { method: "PUT", body: file }));
}
