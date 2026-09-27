import mime from "mime/lite";
import { dirname, extname, relative } from "pathe";
import { withoutLeadingSlash } from "ufo";
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
      /** The base the library's keys are publicly served under. */
      publicUrl: string;
      /**
       * Origin of the store's own S3 API, where presigned uploads go.
       *
       * The admin's CSP needs it to allow the upload the browser PUTs there. It
       * says only where the store lives, which is what a signed URL reveals
       * anyway.
       */
      storeOrigin: string;
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

// A segment starting with a dot, other than a `.` or `..` a relative path walks.
const HIDDEN_SEGMENT = /(?:^|\/)\.[^./]/;

/**
 * Whether a path is a library file: never a hidden one (`.DS_Store`, `.gitkeep`,
 * the object store's `.trash/`), and of a configured type where the library is
 * restricted to some. `null` admits any file.
 */
export function isLibraryFile(path: string, extensions: readonly string[] | null): boolean {
  if (HIDDEN_SEGMENT.test(path)) return false;

  return extensions == null || hasAllowedExtension(path, extensions);
}

/**
 * Whether a path ends in one of `extensions`. The configured list is already
 * lower-cased where the config is resolved, so a hot call, once per repository
 * blob and once per path-shaped token in a body, lowers only the path.
 */
export function hasAllowedExtension(path: string, extensions: readonly string[]): boolean {
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
  const backend = config.mediaBackend;

  if (backend.type === "remote") {
    if (isAbsoluteUrl(ref)) return publicKey(ref, backend.publicUrl);

    return ref.startsWith("/") ? null : trimSlashes(ref);
  }

  const project = base && !ref.startsWith("/") ? assetKey(ref, base) : ref;
  const prefix = `${trimSlashes(config.mediaDirectory)}/`;
  const normalized = withoutLeadingSlash(project);

  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

/** The key a URL under the public base serves. Inverse of {@link remoteMediaUrl}. */
function publicKey(url: string, publicUrl: string): string | null {
  const location = URL.parse(url);
  const base = URL.parse(`${publicUrl}/`);

  if (!location || !base || location.origin !== base.origin || !location.pathname.startsWith(base.pathname)) {
    return null;
  }

  try {
    return decodeURIComponent(location.pathname.slice(base.pathname.length));
  } catch {
    return null;
  }
}

/**
 * How a markdown image names a library file: relative to the entry for a
 * repository library, as astro resolves one, and as the public URL for an
 * object store, which astro fetches as a remote image. {@link mediaPath} reads
 * both back as the library path, so the reference stays tracked.
 */
export function markdownImageUrl(
  path: string,
  config: MediaRefConfig,
  contentFile: string | undefined,
): string {
  const backend = config.mediaBackend;

  if (backend.type === "remote") return remoteMediaUrl(path, backend.publicUrl);

  const ref = mediaRef(path, config);

  return contentFile ? relative(dirname(contentFile), ref.slice(1)) : ref;
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

/** A bucket's S3 API: where requests go, and the region they are signed for. */
export interface S3Target {
  endpoint: string;
  /** Absent to infer it from the endpoint (AWS, R2, B2), falling back to "us-east-1". */
  region?: string;
  pathStyle: boolean;
  bucket: string;
}

/** Bucket URL for requests, including a custom endpoint's path. */
export function s3BaseUrl(target: S3Target): URL {
  const url = new URL(target.endpoint);

  if (target.pathStyle) {
    url.pathname = joinUrl(url.pathname, target.bucket);
  } else {
    url.hostname = `${target.bucket}.${url.hostname}`;
  }

  return url;
}

/** The public URL a library path is served under by a remote backend. */
export function remoteMediaUrl(path: string, publicUrl: string): string {
  return joinUrl(publicUrl, encodeKeyPath(path));
}

/**
 * The content type a file is stored with, decided from its extension rather than
 * from what the uploader declares. A store serves back whatever type it was
 * given, so letting the caller choose it is letting the caller choose how the
 * bytes are interpreted. An extension the registry cannot name is stored as a
 * generic download, which is the safe reading of a file the CMS cannot name.
 */
export function mediaContentType(path: string): string {
  return mime.getType(path) ?? "application/octet-stream";
}

/**
 * Whether a browser would run this type as a document, given the chance: HTML
 * and every XML dialect, SVG among them. SVG is harmless in an `<img>`, which
 * ignores the disposition, and a scriptable document when it is a page of its own.
 */
export function isActiveContentType(type: string): boolean {
  return type === "text/html" || type.endsWith("/xml") || type.endsWith("+xml");
}

/** How the admin previews a library file. */
export type MediaKind = "image" | "video" | "audio" | "file";

/**
 * The kind a file is previewed as, read off the same content type it is stored
 * and served with, so a file the admin shows as a video is one a browser is
 * told is a video.
 */
export function mediaKind(path: string): MediaKind {
  const [type] = mediaContentType(path).split("/");

  return type === "image" || type === "video" || type === "audio" ? type : "file";
}
