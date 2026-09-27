/**
 * Serializable form-field description shared between the Node integration and
 * the browser admin. Zod schemas are introspected once (in Node for content
 * collections, in the browser for CMS component props) and lowered into this
 * plain, JSON-serializable shape via `zodToFieldSchema` (see `zod-to-field.ts`).
 * The admin form renderer consumes `FieldSchema` exclusively, so no live Zod
 * instance ever has to cross the Node/browser boundary.
 *
 * This module is the pure contract: types plus the marker keys, free of any Zod
 * import so it stays trivially usable from both Node and the browser.
 */

export interface FieldMods {
  /** Field may be absent from its parent object (Zod `.optional()`). */
  optional?: boolean;
  /** Field accepts an explicit `null` (Zod `.nullable()`). */
  nullable?: boolean;
  /** Default value from Zod `.default()`, used when the value is missing. */
  default?: unknown;
  /**
   * Set by Zod `.catch()`: the field accepts anything, because the real schema
   * repairs what it cannot parse rather than rejecting it. Only that fact is
   * recorded — the CMS never reads the fallback value, and reading it would mean
   * running the author's catch handler against a fabricated parse failure.
   */
  catch?: true;
}

// Declarative Zod checks that lower losslessly (a serializable number / string /
// regex source). Capturing them keeps the browser-reconstructed validator as
// faithful as possible without shipping the original schema. Arbitrary
// `.refine()` / `.transform()` predicates are functions and cannot be serialized,
// so they remain the one residual gap.
export type FieldSchema = FieldMods &
  (
    | {
        type: "string";
        /** `url` is `z.url()`, `link` the CMS `link()` helper, which also takes a relative URL. */
        format?: "email" | "url" | "link";
        minLength?: number;
        maxLength?: number;
        pattern?: string;
      }
    | {
        type: "number";
        integer?: boolean;
        min?: number;
        max?: number;
        exclusiveMin?: number;
        exclusiveMax?: number;
        multipleOf?: number;
      }
    | { type: "boolean" }
    | { type: "date" }
    | { type: "enum"; options: string[] }
    | { type: "literal"; value: string | number | boolean }
    | { type: "image" }
    | { type: "file" }
    | { type: "reference"; collection: string }
    | { type: "array"; element: FieldSchema; minItems?: number; maxItems?: number }
    | { type: "tuple"; items: FieldSchema[] }
    | { type: "object"; shape: Record<string, FieldSchema> }
    | { type: "record"; value: FieldSchema }
    // `discriminator` is present only for discriminated unions; a plain union
    // omits it and is rendered/explained by its variants alone.
    | { type: "union"; discriminator?: string; variants: FieldSchema[] }
    | { type: "unknown" }
  );

/**
 * The serializable half of a CMS component definition: its lowered prop schema
 * and what may nest inside it. `cms.config`'s live definitions add the admin's
 * React refs (`icon`, `editor`) on top of this, which is why the shared MDX walk
 * and the build take this narrower shape and never the admin's.
 */
export interface ComponentSchema {
  props: FieldSchema | null;
  children?: "markdown" | Record<string, this>;
}

export type ComponentSchemaMap = Record<string, ComponentSchema>;

/**
 * Whether a value has to be written for this field. Every modifier that supplies
 * one of its own answers no: an absent optional, an explicit null, a `.default()`
 * and a `.catch()` fallback all satisfy the real schema, so demanding a value
 * would refuse content the site itself accepts.
 */
export function isRequired(field: FieldSchema): boolean {
  return !field.optional && !field.nullable && field.default === undefined && !field.catch;
}

/** Returns the field map of an object schema, or `undefined` for any other type. */
export function objectShape(
  schema: FieldSchema | null | undefined,
): Record<string, FieldSchema> | undefined {
  return schema?.type === "object" ? schema.shape : undefined;
}

// Zod `.meta()` keys that tag a string field as a CMS asset / cross-reference.
// Writers (see `cms-markers.ts`) tag with these keys; `zod-to-field.ts` reads
// them back when lowering a schema.
export const CMS_IMAGE = "x-cms-image";
export const CMS_FILE = "x-cms-file";
export const CMS_REFERENCE = "x-cms-reference";
export const CMS_LINK = "x-cms-link";
