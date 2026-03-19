export const CONTENT_FORMATS = ["md", "mdx", "mdoc"] as const;
export const DATA_FORMATS = ["json", "yaml", "yml", "toml"] as const;
export const ALL_FORMATS = [...CONTENT_FORMATS, ...DATA_FORMATS] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export type DataFormat = (typeof DATA_FORMATS)[number];
export type EntryFormat = (typeof ALL_FORMATS)[number];

export type CollectionType = "content" | "data";
export type StorageType = "local" | "github" | "gitlab";
export type FileEntryLayout = "array" | "object";

export interface CollectionInfo {
  name: string;
  type: CollectionType;
  loaderType?: "glob" | "file";
  loaderFileName?: string | null;
}

export interface EntryMeta {
  id: string;
  collection: string;
  slug?: string;
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
