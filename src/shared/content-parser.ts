import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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
    default:
      return body;
  }
}
