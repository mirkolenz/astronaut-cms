import { join } from "pathe";
import type { FieldSchema } from "./field-schema.ts";

export const CONTENT_FORMATS = ["md", "mdx", "mdoc"] as const;
export const DATA_FORMATS = ["json", "yaml", "yml", "toml"] as const;
export const ALL_FORMATS = [...CONTENT_FORMATS, ...DATA_FORMATS] as const;
/** Compiles only when `T` is `never`: the drift checks against astro and the editor. */
export type AssertNever<_T extends never> = void;

export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export type DataFormat = (typeof DATA_FORMATS)[number];
export type EntryFormat = (typeof ALL_FORMATS)[number];

/** A file extension as one of the formats the CMS knows, or null for anything else. */
export function asEntryFormat(value: string): EntryFormat | null {
  return (ALL_FORMATS as readonly string[]).includes(value) ? (value as EntryFormat) : null;
}

export type CollectionType = "content" | "data";
export type StorageType = "local" | "github" | "gitlab";
export type FileEntryLayout = "array" | "object";
export type LoaderType = "glob" | "file";

/**
 * How a collection's entries are ordered, for the site (see
 * `astronaut-cms/content`) and in the admin alike.
 *
 * - `id`: by id, as astro's content store returns them.
 * - `natural`: by id, with digit runs compared as numbers (`2` before `10`).
 * - `file`: in the order the file of a `file()` collection holds them, which the
 *   admin then lets editors change.
 */
export type CollectionSort = "id" | "natural" | "file";

const naturalCollator = new Intl.Collator(undefined, { numeric: true });

/**
 * Compares two entry ids under `sort`. File order is no order of ids, so it
 * compares them as astro does, for whatever the file does not place.
 */
export function compareIds(sort: CollectionSort): (a: string, b: string) => number {
  return sort === "natural"
    ? (a, b) => naturalCollator.compare(a, b)
    : (a, b) => a.localeCompare(b);
}

/** Entries by id under `sort`, or as given for file order, which the listing already is. */
export function sortByIds<E extends { id: string }>(entries: readonly E[], sort: CollectionSort): E[] {
  if (sort === "file") return [...entries];

  const compare = compareIds(sort);

  return entries.toSorted((a, b) => compare(a.id, b.id));
}

/**
 * Fully-resolved description of one content collection, extracted from the
 * user's `content.config.ts` in Node and serialized into the admin bundle.
 */
export interface CollectionManifestEntry {
  name: string;
  type: CollectionType;
  schema: FieldSchema | null;
  loaderType: LoaderType;
  loaderPattern: string | string[] | null;
  loaderBase: string | null;
  loaderFileName: string | null;
  sort: CollectionSort;
}

export type CollectionManifest = Record<string, CollectionManifestEntry>;

/**
 * Project-relative directory holding a glob collection's entries: the loader's
 * configured `base`, falling back to the conventional folder for a collection
 * that captured none. The single source of this rule — the storage backends, the
 * dev middleware and the changeset all map paths with it.
 */
export function collectionBase(
  name: string,
  collection?: { loaderBase?: string | null } | null,
): string {
  return collection?.loaderBase ?? `src/content/${name}`;
}

/**
 * Project-relative path of the file an entry's content lives in: its own file in
 * a glob collection, the shared container in a file collection. It is what a
 * relative asset reference written inside that entry resolves against.
 */
export function entryFilePath(
  collection: CollectionManifestEntry,
  id: string,
  format: string,
): string {
  if (collection.loaderType === "file" && collection.loaderFileName) {
    return collection.loaderFileName;
  }

  return join(collectionBase(collection.name, collection), `${id}.${format}`);
}

export interface EntryMeta {
  id: string;
  collection: string;
  format: EntryFormat;
}

/** A file collection's container, as the admin needs to know it. */
export interface FileCollectionInfo {
  layout: FileEntryLayout;
  /**
   * The container's version, which every entry in it shares — reordering is a
   * rewrite of the whole file, so this is what a reorder is based on.
   */
  version?: string;
}

export interface EntryContent {
  id: string;
  data: Record<string, unknown>;
  body: string;
  format: EntryFormat;
  /**
   * What this read saw, as the backend names it. Opaque, and the only thing a
   * caller may do with it is hand it back to the save that follows (see
   * {@link SaveEntryRequest.expectedVersion}).
   */
  version?: string;
}

export interface SaveEntryRequest {
  data: Record<string, unknown>;
  body: string;
  format: EntryFormat;
  /** Refuse the write if the entry already exists. */
  createOnly?: boolean;
  /**
   * The {@link EntryContent.version} this edit was made against, so a write
   * cannot silently discard one that landed while the editor was open. Absent
   * means "whatever is there now", which is what a write with nothing to compare
   * against can honestly claim.
   *
   * Deliberately opaque: it is compared, never dereferenced, so it stays a token
   * the caller echoes back rather than the repository ref that the operation
   * registry exists to keep out of a caller's hands.
   */
  expectedVersion?: string;
}

/** One file in the media library, addressed relative to the library root. */
export interface MediaFile {
  path: string;
  size: number;
  /**
   * What this file's contents are, as the backend names them: the blob hash for
   * a repository library. It makes the file's URL change when the bytes do,
   * which is what lets the admin cache one forever instead of asking the server
   * again for every thumbnail. Absent for a library whose backend has no such
   * name, and then the URL is simply cached for minutes rather than for good.
   */
  version?: string;
}

/**
 * A deletion that can still be undone. Only an object-store library has these: a
 * repository library's deletions are a commit on the draft branch, which git
 * keeps whether or not the CMS does.
 */
export interface TrashedFile {
  /** Opaque to the caller, and what restoring or purging addresses. */
  id: string;
  /** Where restoring would put it back. */
  path: string;
  size: number;
  /** Epoch milliseconds the file was deleted. */
  deletedAt: number;
}

export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

/** One changed file in the pending changeset, with its unified diff when available. */
export interface FileChange {
  path: string;
  kind: ChangeKind;
  /** Previous path, for a rename. */
  previousPath?: string;
  /** Unified diff hunks, omitted for binary files and when no diff can be produced. */
  patch?: string;
}

// Extracts allowed file extensions from loader metadata.
// Handles glob patterns (e.g. "**/*.{md,mdx}") and file loader filenames (e.g. "data.json").
// Returns null if no extensions can be determined.
export function extractFormatsFromLoader(
  pattern: string | string[] | null,
  fileName: string | null,
): string[] | null {
  if (fileName != null) {
    const ext = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[1];
    return ext ? [ext] : null;
  }

  if (pattern == null) return null;

  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const formats = new Set<string>();

  for (const p of patterns) {
    // Match *.{ext1,ext2,...} or *.ext
    const braceMatch = p.match(/\.\{([^}]+)\}\s*$/)?.[1];
    if (braceMatch) {
      for (const ext of braceMatch.split(",")) {
        formats.add(ext.trim());
      }
      continue;
    }
    const singleMatch = p.match(/\.([a-zA-Z0-9]+)\s*$/)?.[1];
    if (singleMatch) {
      formats.add(singleMatch);
    }
  }

  return formats.size > 0 ? [...formats] : null;
}
