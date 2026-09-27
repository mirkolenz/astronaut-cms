import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { FileEntryLayout } from "./types";

/**
 * Extracts the file extension from a file name or path.
 */
export function getFileExtension(fileName: string): string {
  return fileName.split(".").pop() ?? "";
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseContent(
  rawContent: string,
  format: string,
): { data: Record<string, unknown>; body: string } {
  switch (format) {
    case "md":
    case "mdx":
    case "mdoc": {
      const match = FRONTMATTER_RE.exec(rawContent);
      if (!match) return { data: {}, body: rawContent };
      const data = (parseYaml(match[1]) as Record<string, unknown>) ?? {};
      return { data, body: match[2] };
    }
    case "json": {
      const data = JSON.parse(rawContent) as Record<string, unknown>;
      return { data, body: "" };
    }
    case "yaml":
    case "yml": {
      const data = (parseYaml(rawContent) as Record<string, unknown>) ?? {};
      return { data, body: "" };
    }
    case "toml": {
      const data = parseToml(rawContent) as Record<string, unknown>;
      return { data, body: "" };
    }
    default:
      return { data: {}, body: rawContent };
  }
}

export function serializeContent(
  data: Record<string, unknown>,
  body: string,
  format: string,
): string {
  switch (format) {
    case "md":
    case "mdx":
    case "mdoc": {
      const yaml = stringifyYaml(data, { lineWidth: 0 }).trimEnd();
      return `---\n${yaml}\n---\n${body}`;
    }
    case "json":
      return JSON.stringify(data, null, 2) + "\n";
    case "yaml":
    case "yml":
      return stringifyYaml(data, { lineWidth: 0 });
    case "toml":
      return stringifyToml(data as Record<string, string>) + "\n";
    default:
      return body;
  }
}

/** The entries of a file collection, keyed by id in the order the file holds them. */
export type FileEntries = Map<string, Record<string, unknown>>;

// A Map keeps the array's order even for integer-like ids, which an object
// would move to the front.
function arrayEntries(items: Record<string, unknown>[]): FileEntries {
  const entries: FileEntries = new Map();

  for (const item of items) {
    const id = typeof item.id === "string" || typeof item.id === "number" ? `${item.id}` : "";

    if (id) entries.set(id, item);
  }

  return entries;
}

function parseContainer(rawContent: string, format: string): unknown {
  switch (format) {
    case "json":
      return JSON.parse(rawContent);
    case "yaml":
    case "yml":
      return parseYaml(rawContent);
    case "toml":
      return parseToml(rawContent);
    default:
      return null;
  }
}

/** A file collection's container, parsed. */
export interface MultiEntryFile {
  entries: FileEntries;
  layout: FileEntryLayout;
  /** The `$schema` key of an object layout, which astro skips and a rewrite keeps. */
  jsonSchema?: string;
}

/**
 * Parses a file that contains multiple entries (used by file() loader collections).
 * Returns the entries keyed by ID in file order and the detected layout.
 */
export function parseMultiEntryFile(rawContent: string, format: string): MultiEntryFile {
  const parsed = parseContainer(rawContent, format);

  if (Array.isArray(parsed)) return { entries: arrayEntries(parsed), layout: "array" };

  const record = (parsed ?? {}) as Record<string, unknown>;
  const { $schema, ...rest } = record;
  // Only a string `$schema` is a schema reference; astro reads any other as an entry.
  const isReference = typeof $schema === "string";
  const entries = Object.entries(isReference ? rest : record) as [string, Record<string, unknown>][];

  return { entries: new Map(entries), layout: "object", ...(isReference && { jsonSchema: $schema }) };
}

/**
 * Serializes multiple entries back into a single file string.
 * Preserves the original layout (array vs object).
 */
export function serializeMultiEntryFile({ entries, layout, jsonSchema }: MultiEntryFile, format: string): string {
  if (layout === "array") {
    // The map key is the entry id, so it overrides any `id` still embedded in the
    // data: a duplicated entry carries the source's, which would otherwise be
    // written back and collapse the two entries into one on the next read.
    const arr = [...entries].map(([id, data]) => ({ ...data, id }));

    return format === "yaml" || format === "yml"
      ? stringifyYaml(arr, { lineWidth: 0 })
      : JSON.stringify(arr, null, 2) + "\n";
  }

  const record = { ...(jsonSchema !== undefined && { $schema: jsonSchema }), ...Object.fromEntries(entries) };

  switch (format) {
    case "yaml":
    case "yml":
      return stringifyYaml(record, { lineWidth: 0 });
    case "toml":
      return stringifyToml(record as Record<string, Record<string, string>>) + "\n";
    default:
      return JSON.stringify(record, null, 2) + "\n";
  }
}
