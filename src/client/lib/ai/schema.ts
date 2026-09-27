import { z } from "zod";
import {
  CONTENT_FORMATS,
  DATA_FORMATS,
  extractFormatsFromLoader,
  type CollectionManifestEntry,
} from "@shared/types";
import type { FieldSchema } from "@shared/field-schema";

/**
 * Rebuilds a live Zod validator from a serialized {@link FieldSchema}, the inverse
 * of `zodToFieldSchema`. The integration lowers each collection's schema in Node
 * and ships it in the manifest; here the browser reconstructs the schema so the
 * per-collection entry tools expose the real content model to the model as JSON
 * Schema and validate the agent's writes natively.
 *
 * Details the lowering could not capture (refinements, transforms) collapse to
 * their base type, and `unknown` becomes `z.unknown()`, so the reconstruction is a
 * faithful but never stricter view of the original schema.
 */
function base(field: FieldSchema): z.ZodType {
  switch (field.type) {
    case "string": {
      const s = z.string();
      return typeof field.maxLength === "number" ? s.max(field.maxLength) : s;
    }

    case "number":
      return field.integer ? z.int() : z.number();

    case "boolean":
      return z.boolean();

    // Dates are written as ISO strings in frontmatter, so validate them as such.
    case "date":
      return z.string();

    case "enum":
      return field.options.length ? z.enum(field.options as [string, ...string[]]) : z.string();

    case "literal":
      return z.literal(field.value);

    // Assets and references are stored as string paths / entry ids.
    case "image":
    case "file":
    case "reference":
      return z.string();

    case "array":
      return z.array(fieldSchemaToZod(field.element));

    case "tuple":
      return field.items.length
        ? z.tuple(field.items.map(fieldSchemaToZod) as [z.ZodType, ...z.ZodType[]])
        : z.array(z.unknown());

    case "object": {
      const shape: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries(field.shape)) shape[key] = fieldSchemaToZod(value);
      return z.object(shape);
    }

    case "record":
      return z.record(z.string(), fieldSchemaToZod(field.value));

    case "union": {
      const variants = field.variants.map(fieldSchemaToZod);
      return variants.length >= 2
        ? z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]])
        : (variants[0] ?? z.unknown());
    }

    case "unknown":
      return z.unknown();
  }
}

/** Reconstructs a Zod schema for a single field, applying its modifier flags. */
export function fieldSchemaToZod(field: FieldSchema): z.ZodType {
  let schema = base(field);

  if (field.nullable) schema = schema.nullable();
  if (field.optional) schema = schema.optional();
  if (field.default !== undefined) schema = schema.default(field.default);

  return schema;
}

// In a patch every field is optional (omitted = unchanged) and nullable (null =
// remove); its default is dropped so an omitted field is never silently auto-filled.
function patchField(field: FieldSchema): z.ZodType {
  return fieldSchemaToZod({ ...field, default: undefined }).nullable().optional();
}

/**
 * Full data/frontmatter schema for a collection, for a complete overwrite. Falls
 * back to a free record only when the collection declares no schema.
 */
export function collectionDataSchema(
  col: CollectionManifestEntry,
): z.ZodType<Record<string, unknown>> {
  const schema = col.schema ? fieldSchemaToZod(col.schema) : z.record(z.string(), z.unknown());

  return schema as z.ZodType<Record<string, unknown>>;
}

/**
 * Patch schema for a collection, for a partial update: every top-level field is
 * optional and nullable. Falls back to a free record when the collection has no
 * object schema to derive fields from.
 */
export function collectionPatchSchema(
  col: CollectionManifestEntry,
): z.ZodType<Record<string, unknown>> {
  if (col.schema?.type === "object") {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, field] of Object.entries(col.schema.shape)) shape[key] = patchField(field);

    return z.object(shape) as z.ZodType<Record<string, unknown>>;
  }

  return z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>;
}

/**
 * Enum of the file extensions a collection accepts, derived from its loader and
 * falling back to the format set for its kind when the loader is opaque (e.g. a
 * custom loader).
 */
export function collectionFormatEnum(col: CollectionManifestEntry) {
  const formats = extractFormatsFromLoader(col.loaderPattern, col.loaderFileName);
  const resolved = formats?.length ? formats : col.type === "data" ? DATA_FORMATS : CONTENT_FORMATS;

  return z.enum(resolved as [string, ...string[]]);
}
