import type { FieldSchema } from "./field-schema.ts";

export const CONTENT_FORMATS = ["md", "mdx", "mdoc"] as const;
export const DATA_FORMATS = ["json", "yaml", "yml", "toml"] as const;
export const ALL_FORMATS = [...CONTENT_FORMATS, ...DATA_FORMATS] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export type DataFormat = (typeof DATA_FORMATS)[number];
export type EntryFormat = (typeof ALL_FORMATS)[number];

export type CollectionType = "content" | "data";
export type StorageType = "local" | "github" | "gitlab";
export type FileEntryLayout = "array" | "object";
export type LoaderType = "glob" | "file";

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

export interface EntryMeta {
  id: string;
  collection: string;
  format: string;
}

export interface EntryContent {
  id: string;
  data: Record<string, unknown>;
  body: string;
  format: string;
}

export interface SaveEntryRequest {
  data: Record<string, unknown>;
  body: string;
  format: string;
}

export interface MediaFile {
  path: string;
  size: number;
  lastModified: string;
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
    const ext = fileName.match(/\.([a-zA-Z0-9]+)$/);
    return ext ? [ext[1]] : null;
  }

  if (pattern == null) return null;

  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const formats = new Set<string>();

  for (const p of patterns) {
    // Match *.{ext1,ext2,...} or *.ext
    const braceMatch = p.match(/\.\{([^}]+)\}\s*$/);
    if (braceMatch) {
      for (const ext of braceMatch[1].split(",")) {
        formats.add(ext.trim());
      }
      continue;
    }
    const singleMatch = p.match(/\.([a-zA-Z0-9]+)\s*$/);
    if (singleMatch) {
      formats.add(singleMatch[1]);
    }
  }

  return formats.size > 0 ? [...formats] : null;
}
