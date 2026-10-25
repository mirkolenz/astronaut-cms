import { isLibraryFile } from "./media";

// Any letter, as astro's slugged ids keep them, with its marks.
const ALLOWED_SEGMENT_CHARS = /^[\p{L}\p{M}\p{N}_-]+$/u;

/**
 * Validates that a single path segment contains only safe characters.
 * Allows: letters, digits, hyphens, underscores.
 */
function isValidSegment(segment: string): boolean {
  return segment.length > 0 && ALLOWED_SEGMENT_CHARS.test(segment);
}

/**
 * Validates a path that may contain forward slashes (e.g., nested entry IDs like "sub/entry").
 * Each segment between slashes must pass the segment allowlist.
 * Rejects: empty segments, backslashes, "..", null bytes, special characters.
 */
export function validatePath(value: string, name: string): void {
  if (!value) {
    throw new Error(`${name} must not be empty`);
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (!isValidSegment(segment)) {
      throw new Error(
        `Invalid ${name} "${value}": each path segment must contain only letters, digits, hyphens, and underscores`,
      );
    }
  }
}

/**
 * Validates a single path segment (no slashes allowed).
 * Used for collection names and individual entry IDs.
 */
export function validateSegment(value: string, name: string): void {
  if (!isValidSegment(value)) {
    throw new Error(
      `Invalid ${name} "${value}": must contain only letters, digits, hyphens, and underscores`,
    );
  }
}

/**
 * Validates a media library path. Unlike an entry id, a file name carries an
 * extension and often a dot or a space, so this is a rejection list rather than
 * an allowlist: no absolute path, no traversal, no backslash or control
 * character, no empty segment. It runs in the admin before a write and again in
 * the media route before a key is built from it.
 */
export function validateMediaPath(value: string, name = "media path"): void {
  const error = mediaPathError(value, name);

  if (error) throw new Error(error);
}

/** Why a value is not a media library path, or null when it is one. */
export function mediaPathError(value: string, name = "media path"): string | null {
  if (!value) return `${name} must not be empty`;

  if (value.startsWith("/") || /\\|\p{Cc}/u.test(value)) {
    return `Invalid ${name} "${value}": must be a relative path without backslashes`;
  }

  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return `Invalid ${name} "${value}": must not contain empty or traversing segments`;
  }

  return null;
}

/** Why a path is not a file a media library admits, or null when it is one. */
export function libraryPathError(path: string, extensions: readonly string[] | null): string | null {
  return (
    mediaPathError(path) ??
    (isLibraryFile(path, extensions) ? null : `"${path}" is hidden or not of an allowed media type.`)
  );
}
