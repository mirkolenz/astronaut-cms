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

/** `name`, or the first of `name-2`, `name-3` and so on that is not taken. */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  let candidate = name;

  for (let count = 2; taken(candidate); count++) candidate = `${name}-${count}`;

  return candidate;
}
