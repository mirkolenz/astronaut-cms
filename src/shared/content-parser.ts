import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  parse as parseYaml,
  parseDocument,
  stringify as stringifyYaml,
  type Document,
} from "yaml";
import { extname } from "pathe";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { z } from "zod";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";
import type { FileEntryLayout } from "./types";
import { ContentValidationError, diagnostic } from "@/shared/diagnostics";

/**
 * Extracts the file extension from a file name or path.
 */
export const getFileExtension = (fileName: string): string => extname(fileName).slice(1);

const isYaml = (format: string): boolean => format === "yaml" || format === "yml";

interface TomlTable {
  [key: string]: TomlValue;
}

type TomlValue = string | number | bigint | boolean | Date | TomlValue[] | TomlTable;

const tomlValue: z.ZodType<TomlValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.custom<number>((value): value is number => typeof value === "number"),
    z.bigint(),
    z.boolean(),
    z.instanceof(Date),
    z.array(tomlValue),
    z.record(z.string(), tomlValue),
  ]),
);

const tomlTable = z.record(z.string(), tomlValue);

function serializableToml(data: Record<string, unknown>): Record<string, TomlValue> {
  const result = tomlTable.safeParse(data);

  if (!result.success) {
    throw new ContentValidationError(
      result.error.issues.map((issue) =>
        diagnostic("TOML cannot store this value.", issue.path.map(String).join(".")),
      ),
    );
  }

  return result.data;
}

/** The YAML frontmatter a Markdown file opens with, and the body on the lines after it. */
function splitFrontmatter(raw: string): { frontmatter?: string; body: string } {
  const [node] = fromMarkdown(raw, {
    extensions: [frontmatter()],
    mdastExtensions: [frontmatterFromMarkdown()],
  }).children;

  if (node?.type !== "yaml" || !node.position) return { body: raw };

  const newline = raw.indexOf("\n", node.position.end.offset);

  return { frontmatter: node.value, body: newline === -1 ? "" : raw.slice(newline + 1) };
}

export function parseContent(
  rawContent: string,
  format: string,
): { data: Record<string, unknown>; body: string } {
  switch (format) {
    case "md":
    case "mdx":
    case "mdoc": {
      const { frontmatter, body } = splitFrontmatter(rawContent);

      if (frontmatter === undefined) return { data: {}, body };

      const data = (parseYaml(frontmatter) as Record<string, unknown>) ?? {};

      return { data, body };
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
      return stringifyToml(serializableToml(data)) + "\n";
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
    const id = idOf(item.id ?? item.slug);

    if (id) entries.set(id, item);
  }

  return entries;
}

function parseContainer(rawContent: string, format: string): unknown {
  switch (format) {
    case "json":
      return JSON.parse(rawContent);
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
  /** The YAML document, whose comments and blank lines a rewrite keeps. */
  yaml?: Document;
}

/** Parsed once, so the entries and the document a rewrite edits come from the same pass. */
function parseYamlDocument(rawContent: string): Document {
  const doc = parseDocument(rawContent);

  if (doc.errors[0]) throw doc.errors[0];

  return doc;
}

/**
 * Parses a file that contains multiple entries (used by file() loader collections).
 * Returns the entries keyed by ID in file order and the detected layout.
 */
export function parseMultiEntryFile(rawContent: string, format: string): MultiEntryFile {
  const yaml = isYaml(format) ? parseYamlDocument(rawContent) : undefined;
  const parsed: unknown = yaml ? yaml.toJS() : parseContainer(rawContent, format);
  const source = yaml && { yaml };

  if (Array.isArray(parsed)) return { entries: arrayEntries(parsed), layout: "array", ...source };

  const record = (parsed ?? {}) as Record<string, unknown>;
  const { $schema, ...rest } = record;
  // Only a string `$schema` is a schema reference; astro reads any other as an entry.
  const isReference = typeof $schema === "string";
  const entries = Object.entries(isReference ? rest : record) as [string, Record<string, unknown>][];

  return {
    entries: new Map(entries),
    layout: "object",
    ...(isReference && { jsonSchema: $schema }),
    ...source,
  };
}

/**
 * Serializes multiple entries back into a single file string.
 * Preserves the original layout (array vs object).
 */
export function serializeMultiEntryFile(
  { entries, layout, jsonSchema, yaml }: MultiEntryFile,
  format: string,
): string {
  if (layout === "array") {
    // Astro reads `id` first and falls back to `slug`. A duplicate must update
    // whichever field names the source, or the next read would collapse it.
    // An unchanged numeric identifier keeps its type.
    const arr = [...entries].map(([id, data]) => {
      const key = data.id == null && data.slug != null ? "slug" : "id";
      const current = data[key];

      return { ...data, [key]: idOf(current) === id ? current : id };
    });

    return isYaml(format)
      ? serializeYaml(arr, yaml)
      : JSON.stringify(arr, null, 2) + "\n";
  }

  const record = { ...(jsonSchema !== undefined && { $schema: jsonSchema }), ...Object.fromEntries(entries) };

  switch (format) {
    case "yaml":
    case "yml":
      return serializeYaml(record, yaml);
    case "toml":
      return stringifyToml(serializableToml(record)) + "\n";
    default:
      return JSON.stringify(record, null, 2) + "\n";
  }
}

/** An entry's id as the map keys it, or undefined for a value that is none. */
function idOf(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? `${value}`
    : undefined;
}

const sameValue = (node: unknown, value: unknown): boolean =>
  isNode(node) && JSON.stringify(node.toJSON()) === JSON.stringify(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `value` written over `node`, reusing every part of the old tree that still
 * holds the same value, so what a save leaves alone keeps its comments and
 * blank lines. Maps are matched by key and sequence items by `id`, falling back
 * to their position. A replaced node inherits the comments around the old one.
 */
function mergeYaml(doc: Document, node: unknown, value: unknown): unknown {
  if (sameValue(node, value)) return node;

  if (isMap(node) && isRecord(value)) {
    const pairs = new Map(node.items.map((pair) => [isScalar(pair.key) ? idOf(pair.key.value) : undefined, pair]));

    node.items = Object.entries(value).map(([key, item]) => {
      const pair = pairs.get(key);

      if (!pair) return doc.createPair(key, item);

      pair.value = mergeYaml(doc, pair.value, item);

      return pair;
    });

    return node;
  }

  if (isSeq(node) && Array.isArray(value)) {
    const items = node.items;
    const byId = new Map(items.filter(isMap).map((item) => [idOf(item.get("id") ?? item.get("slug")), item]));

    node.items = value.map((item, index) => {
      const id = isRecord(item) ? idOf(item.id ?? item.slug) : undefined;

      return mergeYaml(doc, id === undefined ? items[index] : byId.get(id), item);
    });

    return node;
  }

  const next = doc.createNode(value);

  if (isNode(node)) {
    next.commentBefore = node.commentBefore;
    next.comment = node.comment;
    next.spaceBefore = node.spaceBefore;
  }

  return next;
}

/** A YAML container, written over the document it was read from when there is one. */
function serializeYaml(value: unknown, source: Document | undefined): string {
  if (!source) return stringifyYaml(value, { lineWidth: 0 });

  // The document belongs to the parsed file, which may be serialized again.
  const doc = source.clone();

  const merged = mergeYaml(doc, doc.contents, value);

  doc.contents = isNode(merged) ? merged : doc.createNode(merged);

  return doc.toString({ lineWidth: 0 });
}
