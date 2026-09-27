import { assetKey } from "./asset-path.ts";
import { isAbsoluteUrl, joinUrl, trimSlashes } from "./url.ts";

/**
 * How a media library is addressed. Backends speak library-relative paths; what
 * differs is the string content stores: a project path (`/src/assets/hero.png`)
 * for a repository library, a bare key (`photos/hero.png`) for an object store.
 * Storing the key rather than the URL is what lets a site change bucket or CDN
 * without rewriting entries.
 */

/** Root-relative path of the media route, which serves its whole API from here. */
export const MEDIA_API_BASE = "/_astronaut-cms/media";

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
       * `astro dev` only: the bytes live in the working tree under the media
       * directory rather than in the store, while references keep the store's
       * key format. That split is the point — dev touches no bucket, and an
       * entry edited here is spelled exactly as the build expects it.
       */
      local?: boolean;
    };

interface MediaRefConfig {
  mediaBackend: ClientMediaBackend;
  /** Project-relative media directory. Only meaningful for the `repo` backend. */
  mediaDirectory: string;
}

/** Enforced in the admin before sending, and again in the route: a presigned URL enforces nothing. */
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

  return config.mediaBackend.type === "repo" ? `/${trimSlashes(config.mediaDirectory)}/${key}` : key;
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

/** The public URL a library path is served under by a remote backend. */
export function remoteMediaUrl(path: string, publicUrl: string): string {
  return joinUrl(publicUrl, encodeKeyPath(path));
}

/** Where an upload's bytes go. The Git token must never be attached to a store's own URL. */
export type UploadTarget = { proxy: false; url: string } | { proxy: true };
