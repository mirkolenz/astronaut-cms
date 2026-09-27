/**
 * Serializable form-field description shared between the Node integration and
 * the browser admin. Zod schemas are introspected once (in Node for content
 * collections, in the browser for CMS component props) and lowered into this
 * plain, JSON-serializable shape via {@link zodToFieldSchema}. The admin form
 * renderer consumes `FieldSchema` exclusively, so no live Zod instance ever
 * has to cross the Node/browser boundary.
 */

export interface FieldMods {
  /** Field may be absent from its parent object (Zod `.optional()`). */
  optional?: boolean;
  /** Field accepts an explicit `null` (Zod `.nullable()`). */
  nullable?: boolean;
  /** Default value from Zod `.default()`, used when the value is missing. */
  default?: unknown;
}

export type FieldSchema = FieldMods &
  (
    | { type: "string"; format?: "email" | "url"; maxLength?: number }
    | { type: "number"; integer?: boolean }
    | { type: "boolean" }
    | { type: "date" }
    | { type: "enum"; options: string[] }
    | { type: "literal"; value: string | number | boolean }
    | { type: "image" }
    | { type: "file" }
    | { type: "reference"; collection: string }
    | { type: "array"; element: FieldSchema }
    | { type: "object"; shape: Record<string, FieldSchema> }
    | { type: "record"; value: FieldSchema }
    | { type: "union"; discriminator: string; variants: FieldSchema[] }
    | { type: "unknown" }
  );

/** Returns the field map of an object schema, or `undefined` for any other type. */
export function objectShape(
  schema: FieldSchema | null | undefined,
): Record<string, FieldSchema> | undefined {
  return schema?.type === "object" ? schema.shape : undefined;
}

// Zod `.meta()` keys that tag a string field as a CMS asset / cross-reference.
// This module owns the contract: writers (see `cms-markers.ts`) tag with these
// keys, `convertBase` below reads them. Kept here, free of any zod import, so it
// stays usable from both Node and the browser.
export const CMS_IMAGE = "x-cms-image";
export const CMS_FILE = "x-cms-file";
export const CMS_REFERENCE = "x-cms-reference";

// Minimal duck-typed view of the Zod v4 internals we read. Kept here so this is
// the single place in the codebase that touches Zod's private schema structure.
interface ZodInternal {
  def?: {
    type?: string;
    format?: string;
    defaultValue?: unknown;
    values?: unknown[];
    discriminator?: string;
    options?: unknown[];
    out?: unknown;
  };
  unwrap?: () => unknown;
  shape?: Record<string, unknown>;
  element?: unknown;
  options?: unknown[];
  valueType?: unknown;
  meta?: () => Record<string, unknown> | undefined;
  maxLength?: number | null;
}

/** Lowers a (live) Zod v4 schema into a serializable {@link FieldSchema}. */
export function zodToFieldSchema(schema: unknown): FieldSchema {
  const mods: FieldMods = {};
  let s = schema as ZodInternal | undefined;

  // Peel modifier wrappers, accumulating their effect as flags.
  while (s && typeof s === "object" && s.def) {
    const t = s.def.type;

    if (t === "optional") {
      mods.optional = true;
      s = s.unwrap?.() as ZodInternal | undefined;
    } else if (t === "nullable") {
      mods.nullable = true;
      s = s.unwrap?.() as ZodInternal | undefined;
    } else if (t === "default" || t === "prefault") {
      if (!("default" in mods)) mods.default = s.def.defaultValue;
      s = s.unwrap?.() as ZodInternal | undefined;
    } else if (t === "pipe") {
      s = s.def.out as ZodInternal | undefined;
    } else {
      break;
    }
  }

  const base = convertBase(s);
  if (mods.optional) base.optional = true;
  if (mods.nullable) base.nullable = true;
  if ("default" in mods) base.default = mods.default;

  return base;
}

function convertBase(s: ZodInternal | undefined): FieldSchema {
  if (!s || typeof s !== "object") return { type: "unknown" };

  const meta = s.meta?.();
  if (meta?.[CMS_IMAGE]) return { type: "image" };
  if (meta?.[CMS_FILE]) return { type: "file" };

  const ref = meta?.[CMS_REFERENCE];
  if (typeof ref === "string") return { type: "reference", collection: ref };

  switch (s.def?.type) {
    case "string": {
      const field: FieldSchema = { type: "string" };
      const format = s.def.format;
      if (format === "email") field.format = "email";
      else if (format === "url" || format === "uri") field.format = "url";
      if (typeof s.maxLength === "number") field.maxLength = s.maxLength;
      return field;
    }

    case "number": {
      // Zod 4 marks integer variants (z.int / .int() / int32 / int64) via the
      // `format` field rather than a distinct `def.type`.
      const format = s.def.format;
      const integer = typeof format === "string" && format.includes("int");
      return integer ? { type: "number", integer: true } : { type: "number" };
    }

    case "boolean":
      return { type: "boolean" };

    case "date":
      return { type: "date" };

    case "enum":
      return { type: "enum", options: (s.options ?? []).map(String) };

    case "literal": {
      const value = s.def.values?.[0];
      return {
        type: "literal",
        value:
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? value
            : String(value),
      };
    }

    case "array":
      return { type: "array", element: zodToFieldSchema(s.element) };

    case "object": {
      const shape: Record<string, FieldSchema> = {};
      for (const [key, value] of Object.entries(s.shape ?? {})) {
        shape[key] = zodToFieldSchema(value);
      }
      return { type: "object", shape };
    }

    case "record":
      return { type: "record", value: zodToFieldSchema(s.valueType) };

    case "union": {
      // Only discriminated unions get a dedicated variant editor; a plain union
      // has no selector key, so it falls back to the raw editor via "unknown".
      const discriminator = s.def.discriminator;
      if (typeof discriminator !== "string") return { type: "unknown" };
      return {
        type: "union",
        discriminator,
        variants: (s.def.options ?? []).map((option) => zodToFieldSchema(option)),
      };
    }

    default:
      return { type: "unknown" };
  }
}
