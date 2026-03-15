import { ALL_FORMATS } from "./types";

const ALLOWED_SEGMENT_CHARS = /^[a-zA-Z0-9_-]+$/;

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
 * Validates that a format string is one of the allowed content/data formats.
 */
export function validateFormat(format: string, name = "format"): void {
  if (!(ALL_FORMATS as readonly string[]).includes(format)) {
    throw new Error(`Invalid ${name} "${format}": must be one of ${ALL_FORMATS.join(", ")}`);
  }
}
