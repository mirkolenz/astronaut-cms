/**
 * Path shapes both sides of the CMS have to agree on: the storage backends build
 * them, the admin reads them back off a changeset.
 */
import { relative } from "pathe";

export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");

  return dot === -1 ? filename : filename.slice(0, dot);
}

/** The library-relative form of a repository path, or null when it is outside the library. */
export function stripMediaPrefix(path: string, mediaDirectory: string): string | null {
  const rel = relative(mediaDirectory, path);

  return rel.startsWith("..") ? null : rel;
}
