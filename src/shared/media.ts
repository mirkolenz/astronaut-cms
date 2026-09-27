import mime from "mime/lite";
import { dirname, extname, relative } from "pathe";
import { assetKey } from "./asset-path.ts";
import { uniqueName } from "./paths.ts";
import { isAbsoluteUrl, joinUrl, trimSlashes } from "./url.ts";
import type { ResolvedImageOptimization } from "../integration/types.ts";

/**
 * How the media libraries are addressed. There are at most two: the repository
 * library, always present, and an object store beside it. Backends speak
 * library-relative paths, and content stores a reference that names the library
 * by its shape: a project path (`/src/assets/logo.svg`) for the repository, the
 * public URL (`https://cdn.example.com/photos/hero.png`) for the object store.
 * The URL is what astro itself resolves as a remote image, in a collection
 * `image()` field and a markdown body alike, so an object-store reference needs
 * nothing of the CMS to render.
 */

export const S3_ACCESS_KEY_ID_ENV = "ASTRONAUT_CMS_S3_ACCESS_KEY_ID";
export const S3_SECRET_ACCESS_KEY_ENV = "ASTRONAUT_CMS_S3_SECRET_ACCESS_KEY";
export const S3_SESSION_TOKEN_ENV = "ASTRONAUT_CMS_S3_SESSION_TOKEN";

export type MediaLibraryId = "repo" | "s3";

/** One file of one library, which is what identifies it across both. */
export interface MediaLocation {
  library: MediaLibraryId;
  path: string;
}

/** Bounds on a file's size in bytes, null where there is none. */
export interface SizeLimits {
  minFileSize: number | null;
  maxFileSize: number | null;
}

/** What decides which files a library takes, and how an image is reshaped on the way in. */
export interface ClientLibrary extends SizeLimits {
  /** Overrides the admin's translated name for the library. */
  label: string | null;
  /** Extensions the library lists and accepts, already lower-cased, or null for any file. */
  extensions: string[] | null;
  /** How to reshape an image before uploading it here, or null when uploads go untouched. */
  imageOptimization: ResolvedImageOptimization | null;
  /**
   * Project-relative directory holding the library's bytes in the working tree
   * or repository, absent where they live in a store instead.
   */
  directory?: string;
}

/** A library whose bytes are files of the project, as the storage backends serve one. */
export type WorkingTreeLibrary = ClientLibrary & { directory: string };

/** What the admin bundle may know of the object store: never an endpoint, a bucket or a credential. */
export interface ClientS3Library extends ClientLibrary {
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
   * `astro dev` only: the directory holding the bytes instead of the store,
   * while references keep the store's URL format. That split is the point, dev
   * touches no bucket, and an entry edited here is spelled exactly as the build
   * expects it.
   */
  directory?: string;
}

/** Both libraries as the admin, the site and the server read them. */
export interface ClientMediaConfig {
  repo: WorkingTreeLibrary;
  /** Null when no object store is configured. */
  s3: ClientS3Library | null;
}

/**
 * What spelling and reading a reference needs, and all the site's asset
 * resolver is handed, so a page resolving an asset carries no more of the config.
 */
export interface MediaRefConfig {
  repo: Pick<WorkingTreeLibrary, "directory">;
  s3: Pick<ClientS3Library, "publicUrl" | "directory"> | null;
}

/** The libraries this site has, the repository first. */
export function mediaLibraries(media: ClientMediaConfig): MediaLibraryId[] {
  return media.s3 ? ["repo", "s3"] : ["repo"];
}

/** A library this site has, as a route or a caller names it, or null. */
export function parseMediaLibrary(media: ClientMediaConfig, value: unknown): MediaLibraryId | null {
  return mediaLibraries(media).find((id) => id === value) ?? null;
}

/** The object store, which throws for a site that does not have one. */
export function s3Library<T extends MediaRefConfig["s3"]>(media: { s3: T }): NonNullable<T> {
  if (!media.s3) throw new Error("No object-store media library is configured.");

  return media.s3;
}

/** A library's own config, which throws for an object store the site does not have. */
export function mediaLibrary(media: ClientMediaConfig, library: MediaLibraryId): ClientLibrary {
  return library === "repo" ? media.repo : s3Library(media);
}

/** Every directory of the project a library keeps its bytes in. */
export function libraryDirectories(media: ClientMediaConfig): string[] {
  return mediaLibraries(media).flatMap((id) => mediaLibrary(media, id).directory ?? []);
}

/**
 * Whether a media write joins the pending changeset, and is therefore as
 * reviewable and as discardable as any other change.
 *
 * A library in the project *is* the storage backend: the repository library,
 * and the working tree a dev run puts in front of the object store. Only a live
 * store writes outside the changeset.
 */
export function isTransactionalMedia(media: ClientMediaConfig, library: MediaLibraryId): boolean {
  return mediaLibrary(media, library).directory != null;
}

export const megabytes = (bytes: number): string => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/** Why a file of `size` bytes is refused by a library, or null when it fits. */
export function sizeLimitError(size: number, limits: SizeLimits): string | null {
  if (limits.maxFileSize != null && size > limits.maxFileSize) {
    return `File is larger than the ${megabytes(limits.maxFileSize)} limit for this media library.`;
  }

  if (limits.minFileSize != null && size < limits.minFileSize) {
    return `File is smaller than the ${megabytes(limits.minFileSize)} minimum for this media library.`;
  }

  return null;
}

/** Why a library refuses a file, by its type or its size, or null when it takes it. */
export function libraryRefusal(library: ClientLibrary, name: string, size: number): string | null {
  if (!isLibraryFile(name, library.extensions)) return `"${name}" is not of a type this media library accepts.`;

  return sizeLimitError(size, library);
}

/** Why a field astro types as an imported image refuses an object-store file. */
export const repoOnlyRefusal = (value: string): string =>
  `"${value}" is an object-store file, but this field only takes repository files. Declare it with libraryImage(image) to accept both.`;

/** Enforced in the admin before sending, and again on the server, which is where it counts. */
export function assertWithinSizeLimit(size: number, limits: SizeLimits): void {
  const error = sizeLimitError(size, limits);

  if (error) throw new Error(error);
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

/** How a reference to the libraries reads, wherever one has to be explained. */
export function describeMediaRef(media: MediaRefConfig): string {
  const repo = `a path under the media directory ("/${trimSlashes(media.repo.directory)}/...")`;

  return media.s3 ? `${repo} or a URL under "${media.s3.publicUrl}/"` : repo;
}

/** The string content stores for a library file. Inverse of {@link mediaPath}. */
export function mediaRef({ library, path }: MediaLocation, media: MediaRefConfig): string {
  if (library === "s3") return remoteMediaUrl(path, s3Library(media).publicUrl);

  return `/${trimSlashes(media.repo.directory)}/${trimSlashes(path)}`;
}

/**
 * The library file an asset reference names, or null when the reference does not
 * address a media library at all (a path outside the media directory, a URL
 * under some other host). Callers treat null as "this value cannot resolve",
 * which is exactly what it means at render time.
 *
 * `base` is the content file a relative reference is written in. Rebasing is a
 * repository-library rule: an object-store reference is an absolute URL.
 */
export function mediaPath(
  ref: string,
  media: MediaRefConfig,
  base?: string,
): MediaLocation | null {
  if (isAbsoluteUrl(ref)) {
    const key = media.s3 && publicKey(ref, media.s3.publicUrl);

    return key ? { library: "s3", path: key } : null;
  }

  const project = base && !ref.startsWith("/") ? assetKey(ref, base) : ref;
  const prefix = `${trimSlashes(media.repo.directory)}/`;
  const normalized = project.replace(/^\//, "");

  return normalized.startsWith(prefix)
    ? { library: "repo", path: normalized.slice(prefix.length) }
    : null;
}

/** The key a URL under the public base serves. Inverse of {@link remoteMediaUrl}. */
function publicKey(url: string, publicUrl: string): string | null {
  const location = URL.parse(url);
  const base = URL.parse(`${publicUrl}/`);

  if (!location || !base || location.origin !== base.origin || !location.pathname.startsWith(base.pathname)) {
    return null;
  }

  try {
    return decodeURIComponent(location.pathname.slice(base.pathname.length)) || null;
  } catch {
    return null;
  }
}

/**
 * How a markdown image names a library file: relative to the entry for the
 * repository library, as astro resolves one, and as its reference otherwise.
 * {@link mediaPath} reads both back as the library file, so the reference stays
 * tracked.
 */
export function markdownImageUrl(
  location: MediaLocation,
  media: MediaRefConfig,
  contentFile: string | undefined,
): string {
  const ref = mediaRef(location, media);

  return location.library === "repo" && contentFile ? relative(dirname(contentFile), ref.slice(1)) : ref;
}

/**
 * A library path nothing occupies yet, numbering the name until it is free. An
 * upload that cannot ask a human what to do — an AI attachment called
 * `logo.png`, say — lands beside the existing file rather than replacing it.
 */
export function uniqueMediaPath(path: string, taken: ReadonlySet<string>): string {
  const ext = extname(path);

  return uniqueName(path.slice(0, path.length - ext.length), (stem) => taken.has(`${stem}${ext}`)) + ext;
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
