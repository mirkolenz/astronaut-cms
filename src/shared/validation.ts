import { isLibraryFile } from "@/shared/media";

// Any letter, as astro's slugged ids keep them, with its marks.
const ALLOWED_SEGMENT_CHARS = /^[\p{L}\p{M}\p{N}_-]+$/u;

// Why a value is refused as a path, as stable codes: the server words them in
// English, the admin translates them.
type IdIssue = "empty" | "characters" | "nestedCharacters";
type MediaPathIssue = "empty" | "absolute" | "segments";
export type PathIssue = IdIssue | MediaPathIssue;

/**
 * Why a value is not an entry id, or null when it is one. A nested id may
 * contain forward slashes ("sub/entry"), and each segment between them must
 * contain only letters, digits, hyphens, and underscores.
 */
export function idIssue(value: string, nested = true): IdIssue | null {
  if (!value) return "empty";

  const segments = nested ? value.split("/") : [value];

  if (segments.every((segment) => ALLOWED_SEGMENT_CHARS.test(segment))) return null;

  return nested ? "nestedCharacters" : "characters";
}

/**
 * Validates a path that may contain forward slashes (e.g., nested entry IDs like "sub/entry").
 * Rejects: empty segments, backslashes, "..", null bytes, special characters.
 */
export function validatePath(value: string, name: string): void {
  const issue = idIssue(value);

  if (issue === "empty") throw new Error(`${name} must not be empty`);

  if (issue) {
    throw new Error(
      `Invalid ${name} "${value}": each path segment must contain only letters, digits, hyphens, and underscores`,
    );
  }
}

/**
 * Why a value is not a media library path, or null when it is one. Unlike an
 * entry id, a file name carries an extension and often a dot or a space, so
 * this is a rejection list rather than an allowlist: no absolute path, no
 * traversal, no backslash or control character, no empty segment.
 */
export function mediaPathIssue(value: string): MediaPathIssue | null {
  if (!value) return "empty";

  if (value.startsWith("/") || /\\|\p{Cc}/u.test(value)) return "absolute";

  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "segments";
  }

  return null;
}

/**
 * Why a value is not a media library path, or null when it is one. It runs in
 * the admin before a write and again in the media route before a key is built from it.
 */
export function mediaPathError(value: string, name = "media path"): string | null {
  switch (mediaPathIssue(value)) {
    case "empty":
      return `${name} must not be empty`;
    case "absolute":
      return `Invalid ${name} "${value}": must be a relative path without backslashes`;
    case "segments":
      return `Invalid ${name} "${value}": must not contain empty or traversing segments`;
    case null:
      return null;
  }
}

/** Why a path is not a file a media library admits, or null when it is one. */
export function libraryPathError(
  path: string,
  extensions: readonly string[] | null,
): string | null {
  return (
    mediaPathError(path) ??
    (isLibraryFile(path, extensions)
      ? null
      : `"${path}" is hidden or not of an allowed media type.`)
  );
}
