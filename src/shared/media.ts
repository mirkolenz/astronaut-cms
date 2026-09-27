import { extname } from "pathe";
import { assetKey } from "./asset-path.ts";
import { isAbsoluteUrl, joinUrl, trimSlashes } from "./url.ts";

/**
 * How a media library is addressed. Backends speak library-relative paths; what
 * differs is the string content stores: a project path (`/src/assets/hero.png`)
 * for a repository library, a bare key (`photos/hero.png`) for an object store.
 * Storing the key rather than the URL is what lets a site change bucket or CDN
 * without rewriting entries.
 */

export const S3_ACCESS_KEY_ID_ENV = "ASTRONAUT_CMS_S3_ACCESS_KEY_ID";
export const S3_SECRET_ACCESS_KEY_ENV = "ASTRONAUT_CMS_S3_SECRET_ACCESS_KEY";
export const S3_SESSION_TOKEN_ENV = "ASTRONAUT_CMS_S3_SESSION_TOKEN";

/** What the admin bundle may know: never an endpoint, a bucket or a credential. */
export type ClientMediaBackend =
  | { type: "repo" }
  | {
      type: "remote";
      /** The base the library's keys are publicly served under, absent for a private library. */
      publicUrl?: string;
      /**
       * Origin of the store's own S3 API, absent when it cannot be signed for
       * and every upload is proxied through the site instead.
       *
       * Two things need it, and both need exactly this: the admin's CSP, which
       * has to allow the upload the browser PUTs there, and astro's
       * `image.remotePatterns` for a private library, whose images are fetched
       * from signed URLs on that same origin. It says only where the store
       * lives, which is what a signed URL reveals anyway.
       */
      storeOrigin?: string;
      /**
       * `astro dev` only: the bytes live in the working tree under the media
       * directory rather than in the store, while references keep the store's
       * key format. That split is the point — dev touches no bucket, and an
       * entry edited here is spelled exactly as the build expects it.
       */
      local?: boolean;
    };

export interface MediaRefConfig {
  mediaBackend: ClientMediaBackend;
  /** Project-relative media directory. Only meaningful for the `repo` backend. */
  mediaDirectory: string;
}

/**
 * Whether a media write joins the pending changeset, and is therefore as
 * reviewable and as discardable as any other change.
 *
 * A repository library *is* the storage backend, and so is the working tree a
 * dev run puts in front of an object store; only a live store writes outside the
 * changeset. Decided from the config rather than from a constructed backend, so
 * a module can gate on it at load time.
 */
export function isTransactionalMedia(backend: ClientMediaBackend): boolean {
  return backend.type === "repo" || backend.local === true;
}

/** Enforced in the admin before sending, and again on the server, which is where it counts. */
export function assertWithinSizeLimit(size: number, maxFileSize: number | null): void {
  if (maxFileSize != null && size > maxFileSize) {
    throw new Error(
      `File is larger than the ${Math.round(maxFileSize / 1024 / 1024)} MB limit for this media library.`,
    );
  }
}

/**
 * The library holds the configured file types and nothing else. `extensions` is
 * already lower-cased where the config is resolved, so a hot call — once per
 * repository blob, once per path-shaped token in a body — lowers only the path.
 */
export function hasAllowedExtension(path: string, extensions: string[]): boolean {
  const lower = path.toLowerCase();

  return extensions.some((ext) => lower.endsWith(ext));
}

/**
 * Each segment encoded: a key may hold a space or a `#`, which would otherwise
 * address something other than the object the store actually holds. Shared by
 * the public URL and by an S3 `CopySource`, which is parsed rather than decoded.
 */
export const encodeKeyPath = (path: string): string =>
  trimSlashes(path).split("/").map(encodeURIComponent).join("/");

/** How a reference to this library reads, wherever one has to be explained. */
export function describeMediaRef(config: MediaRefConfig): string {
  return config.mediaBackend.type === "remote"
    ? "a key in the media library"
    : `a path under the media directory ("${config.mediaDirectory}")`;
}

/** The string content stores for a library path. Inverse of {@link mediaPath}. */
export function mediaRef(path: string, config: MediaRefConfig): string {
  const key = trimSlashes(path);

  return config.mediaBackend.type === "repo"
    ? `/${trimSlashes(config.mediaDirectory)}/${key}`
    : key;
}

/**
 * The library path an asset reference names, or null when the reference does not
 * address the media library at all (a path outside the media directory, a bare
 * URL, anything absolute under a remote backend). Callers treat null as "this
 * value cannot resolve", which is exactly what it means at render time.
 *
 * `base` is the content file a relative reference is written in. Rebasing is a
 * repository-library rule: an object store has no directories to be relative to,
 * and its references are bare keys, so a base is ignored there.
 */
export function mediaPath(ref: string, config: MediaRefConfig, base?: string): string | null {
  if (config.mediaBackend.type === "remote") {
    return ref.startsWith("/") || isAbsoluteUrl(ref) ? null : trimSlashes(ref);
  }

  const project = base && !ref.startsWith("/") ? assetKey(ref, base) : ref;
  const prefix = `${trimSlashes(config.mediaDirectory)}/`;
  const normalized = project.replace(/^\/+/, "");

  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

/**
 * A library path nothing occupies yet, numbering the name until it is free. An
 * upload that cannot ask a human what to do — an AI attachment called
 * `logo.png`, say — lands beside the existing file rather than replacing it.
 */
export function uniqueMediaPath(path: string, taken: ReadonlySet<string>): string {
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);

  for (let n = 1; ; n++) {
    const candidate = n === 1 ? path : `${stem}-${n}${ext}`;

    if (!taken.has(candidate)) return candidate;
  }
}

/** Where a presigned upload is addressed: the endpoint, or the bucket's virtual host. */
export interface S3Target {
  endpoint: string;
  pathStyle: boolean;
  bucket: string;
}

/**
 * Origin a presigned PUT against this target points at. Virtual-host addressing
 * puts the bucket in the hostname, so it is the endpoint's origin only when
 * path-style is forced.
 *
 * Pure URL arithmetic, and shared because the two things that need it sit on
 * opposite sides of the build: the SDK the route configures, and the admin's
 * CSP, which the integration resolves. A `connect-src` that disagrees with the
 * SDK blocks every upload with no error an operator can read.
 */
export function presignedUploadOrigin(target: S3Target): string {
  const url = new URL(target.endpoint);

  if (!target.pathStyle) url.hostname = `${target.bucket}.${url.hostname}`;

  return url.origin;
}

/** The public URL a library path is served under by a remote backend. */
export function remoteMediaUrl(path: string, publicUrl: string): string {
  return joinUrl(publicUrl, encodeKeyPath(path));
}

// Types the library's default extensions map to. Anything unlisted is stored as
// a generic download, which is the safe reading of a file the CMS cannot name.
const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

// Types a browser executes when it navigates to them. SVG is the one the library
// accepts by default: harmless in an `<img>`, which ignores the disposition, and
// a scriptable document when it is a page of its own.
const ACTIVE_CONTENT_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
]);

/**
 * The content type a file is stored with, decided from its extension rather than
 * from what the uploader declares. A store serves back whatever type it was
 * given, so letting the caller choose it is letting the caller choose how the
 * bytes are interpreted.
 */
export function mediaContentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Whether a browser would run this type as a document, given the chance. */
export function isActiveContentType(type: string): boolean {
  return ACTIVE_CONTENT_TYPES.has(type);
}
