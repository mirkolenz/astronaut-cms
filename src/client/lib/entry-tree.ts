import { compareIds } from "@/shared/types";

export interface DirectoryListing<T> {
  folders: PathSegment[];
  files: T[];
}

export interface PathSegment {
  name: string;
  path: string;
}

/** The directory containing `id` ("" when the id sits at the collection root). */
export function parentDir(id: string): string {
  const slash = id.lastIndexOf("/");

  return slash === -1 ? "" : id.slice(0, slash);
}

/** Cumulative segments of a directory path, each carrying its full path for linking. */
export function dirSegments(dir: string): PathSegment[] {
  if (!dir) return [];

  let path = "";

  return dir.split("/").map((name) => {
    path = path ? `${path}/${name}` : name;

    return { name, path };
  });
}

/**
 * Splits items into the immediate subfolders and the ones directly under `dir`
 * (a slash-joined prefix, "" being the root). Deeply nested items surface as
 * folders so the user drills down one level at a time instead of facing one flat
 * list. `key` is the slash-joined path to group by: an entry id in a collection,
 * a library path in the media browser. `compare` orders both lists by name.
 */
export function listDirectory<T>(
  items: T[],
  dir: string,
  key: (item: T) => string,
  compare: (a: string, b: string) => number = compareIds("id"),
): DirectoryListing<T> {
  const prefix = dir ? `${dir}/` : "";
  const folders = new Set<string>();
  const files: T[] = [];

  for (const item of items) {
    if (!key(item).startsWith(prefix)) continue;

    const rest = key(item).slice(prefix.length);
    const slash = rest.indexOf("/");

    if (slash === -1) {
      files.push(item);
    } else {
      folders.add(rest.slice(0, slash));
    }
  }

  return {
    folders: [...folders].sort(compare).map((name) => ({ name, path: `${prefix}${name}` })),
    files: files.sort((a, b) => compare(key(a), key(b))),
  };
}
