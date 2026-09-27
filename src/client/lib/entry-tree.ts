import type { EntryMeta } from "@shared/types";

export interface DirectoryListing {
  folders: PathSegment[];
  files: EntryMeta[];
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

/** The last path segment of `id`, i.e. its display name within its folder. */
export function baseName(id: string): string {
  const slash = id.lastIndexOf("/");

  return slash === -1 ? id : id.slice(slash + 1);
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
 * Splits entries into the immediate subfolders and the files directly under
 * `dir` (a slash-joined prefix, "" being the collection root). Deeply nested
 * entries surface as folders so the user drills down one level at a time
 * instead of facing one flat list.
 */
export function listDirectory(entries: EntryMeta[], dir: string): DirectoryListing {
  const prefix = dir ? `${dir}/` : "";
  const folders = new Set<string>();
  const files: EntryMeta[] = [];

  for (const entry of entries) {
    if (!entry.id.startsWith(prefix)) continue;

    const rest = entry.id.slice(prefix.length);
    const slash = rest.indexOf("/");

    if (slash === -1) {
      files.push(entry);
    } else {
      folders.add(rest.slice(0, slash));
    }
  }

  return {
    folders: [...folders]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, path: `${prefix}${name}` })),
    files: files.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
