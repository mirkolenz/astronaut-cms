/**
 * The media library from the admin's side: a URL for every file, and the upload
 * that is the one thing here with more than one step.
 *
 * Reading is a plain URL, and where that URL points is settled here rather than
 * by a round trip. A library served from a public base needs no server at all:
 * the key *is* the URL, so a grid of thumbnails costs nothing. Everything else —
 * a repository library, a private bucket, a dev run reading the working tree —
 * goes through `GET .../media/<path>`, which answers with the bytes or redirects
 * to wherever they really live. Either way an `<img>` addresses a library file
 * the same way, with no fetch, no object URL and no lifetime to manage.
 */
import config from "virtual:astronaut-cms/config";
import { API_BASE } from "@shared/auth";
import { assertWithinSizeLimit, encodeKeyPath, remoteMediaUrl } from "@shared/media";
import { apiFetch, apiUrl, call, unwrap } from "./api";

/** Where the admin loads one library file from. */
export function mediaUrl(path: string): string {
  const backend = config.mediaBackend;

  if (backend.type === "remote" && !backend.local && backend.publicUrl) {
    return remoteMediaUrl(path, backend.publicUrl);
  }

  return apiUrl(`${API_BASE}/media/${encodeKeyPath(path)}`);
}

/**
 * Uploads a file, taking whichever route the server says this library uses.
 *
 * The direct route is the normal one: the server signs a URL for this exact file
 * at this exact key, and the browser sends the bytes straight to the store. The
 * bytes never pass through a serverless function, and the library's rules travel
 * with the signature, so the store applies them to the write itself rather than
 * this server having to check afterwards what arrived.
 */
export async function uploadMedia(path: string, file: File, overwrite = false): Promise<void> {
  // Refused here too, so an oversized file is not sent before being rejected.
  assertWithinSizeLimit(file.size, config.maxFileSize);

  const ticket = await call("beginUpload", { path, size: file.size, overwrite });

  if (!ticket.direct) {
    const query = new URLSearchParams({ path, ...(overwrite && { overwrite: "true" }) });

    // Through `unwrap` like every other CMS call: the route answers in the same
    // envelope, so a lapsed session and a refused destination read the same way
    // here as they do everywhere else.
    await unwrap(
      await apiFetch(apiUrl(`${API_BASE}/upload?${query}`), { method: "PUT", body: file }),
    );

    return;
  }

  // Sent verbatim: they are signed into the URL, so changing or dropping one
  // makes the store reject the request rather than accept different terms.
  const stored = await fetch(ticket.url, {
    method: "PUT",
    headers: ticket.headers,
    body: file,
  });

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

