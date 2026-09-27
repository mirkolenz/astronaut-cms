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

/**
 * Parses a file that contains multiple entries (used by file() loader collections).
 * Returns a record of entries keyed by ID and the detected layout.
 */
export function parseMultiEntryFile(
  rawContent: string,
  format: string,
): { entries: Record<string, Record<string, unknown>>; layout: FileEntryLayout } {
  switch (format) {
    case "json": {
      const parsed = JSON.parse(rawContent) as unknown;
      if (Array.isArray(parsed)) {
        const entries: Record<string, Record<string, unknown>> = {};
        for (const item of parsed as Record<string, unknown>[]) {
          const id = typeof item.id === "string" || typeof item.id === "number" ? `${item.id}` : "";
          if (id) entries[id] = item;
        }
        return { entries, layout: "array" };
      }
      return { entries: parsed as Record<string, Record<string, unknown>>, layout: "object" };
    }
    case "yaml":
    case "yml": {
      const parsed = parseYaml(rawContent) as unknown;
      if (Array.isArray(parsed)) {
        const entries: Record<string, Record<string, unknown>> = {};
        for (const item of parsed as Record<string, unknown>[]) {
          const id = typeof item.id === "string" || typeof item.id === "number" ? `${item.id}` : "";
          if (id) entries[id] = item;
        }
        return { entries, layout: "array" };
      }
      return {
        entries: (parsed as Record<string, Record<string, unknown>>) ?? {},
        layout: "object",
      };
    }
    case "toml": {
      const parsed = parseToml(rawContent) as Record<string, Record<string, unknown>>;
      return { entries: parsed, layout: "object" };
    }
    default:
      return { entries: {}, layout: "object" };
  }
}

/**
 * Serializes multiple entries back into a single file string.
 * Preserves the original layout (array vs object).
 */
export function serializeMultiEntryFile(
  entries: Record<string, Record<string, unknown>>,
  format: string,
  layout: FileEntryLayout,
): string {
  if (layout === "array") {
    // The map key is the entry id, so it overrides any `id` still embedded in the
    // data: a duplicated entry carries the source's, which would otherwise be
    // written back and collapse the two entries into one on the next read.
    const arr = Object.entries(entries).map(([id, data]) => ({ ...data, id }));
    switch (format) {
      case "json":
        return JSON.stringify(arr, null, 2) + "\n";
      case "yaml":
      case "yml":
        return stringifyYaml(arr, { lineWidth: 0 });
      default:
        return JSON.stringify(arr, null, 2) + "\n";
    }
  }

  switch (format) {
    case "json":
      return JSON.stringify(entries, null, 2) + "\n";
    case "yaml":
    case "yml":
      return stringifyYaml(entries, { lineWidth: 0 });
    case "toml":
      return stringifyToml(entries as Record<string, Record<string, string>>) + "\n";
    default:
      return JSON.stringify(entries, null, 2) + "\n";
  }
}
