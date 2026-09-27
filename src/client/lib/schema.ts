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
      // Zod's own email check, wrapped so the schema stays a plain string: its
      // lowered form is a ~130-character regex that no model needs to read and
      // that grammar-constrained samplers cannot compile. `url` lowers to a bare
      // `format`, so it passes through as it is.
      if (field.format === "email") {
        return z
          .string()
          .refine((value) => z.email().safeParse(value).success, "Expected an email address.")
          .describe("Email address.");
      }

      if (field.format === "url") return z.url();

      let s = z.string();
      if (typeof field.minLength === "number") s = s.min(field.minLength);
      if (typeof field.maxLength === "number") s = s.max(field.maxLength);
      if (field.pattern) s = s.regex(new RegExp(field.pattern));

      return s;
    }

    case "number": {
      let n = field.integer ? z.int() : z.number();
      if (typeof field.min === "number") n = n.min(field.min);
      if (typeof field.max === "number") n = n.max(field.max);
      if (typeof field.exclusiveMin === "number") n = n.gt(field.exclusiveMin);
      if (typeof field.exclusiveMax === "number") n = n.lt(field.exclusiveMax);
      if (typeof field.multipleOf === "number") n = n.multipleOf(field.multipleOf);

      return n;
    }

    case "boolean":
      return z.boolean();

    // Dates are written as ISO strings in frontmatter, and an unparseable one is
    // what takes the dev server down: Astro coerces it to an Invalid Date, which
    // fails its own content sync. The check is a refinement rather than an ISO
    // format so that it stays out of the JSON Schema — zod lowers those to a
    // several-hundred-character regex, which bloats every tool the model sees and
    // defeats grammar-constrained samplers such as llama.cpp's.
    case "date":
      return z
        .string()
        .refine((value) => !Number.isNaN(Date.parse(value)), "Expected a date.")
        .describe('ISO date, e.g. "2026-01-31".');

    case "enum":
      return field.options.length ? z.enum(field.options as [string, ...string[]]) : z.string();

    case "literal":
      return z.literal(field.value);

    // Assets and references are stored as string paths / entry ids, so the field
    // alone tells the model nothing about what makes one valid. A short note
    // costs a few dozen bytes and saves the round trip a rejected write costs.
    case "image":
    case "file":
      return z.string().describe('Media library path from listMedia, e.g. "/src/assets/hero.png".');

    case "reference":
      return z.string().describe(`Id of an entry in the "${field.collection}" collection.`);

    case "array": {
      let a = z.array(fieldSchemaToZod(field.element));
      if (typeof field.minItems === "number") a = a.min(field.minItems);
      if (typeof field.maxItems === "number") a = a.max(field.maxItems);

      return a;
    }

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

      if (variants.length < 2) return variants[0] ?? z.unknown();

      // A discriminated union round-trips back to one: it gives the model (and
      // validation errors) the discriminant the original schema declared, which
      // a plain union erases. The discriminator is only set for unions whose
      // variants are all objects, so the cast is sound.
      if (field.discriminator !== undefined) {
        return z.discriminatedUnion(
          field.discriminator,
          variants as [z.ZodObject, z.ZodObject, ...z.ZodObject[]],
        );
      }

      return z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
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
  return fieldSchemaToZod({ ...field, default: undefined })
    .nullable()
    .optional();
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
 * Starting data for a new entry: the defaults the schema declares and nothing
 * else. Required fields are deliberately left empty — a synthesized value would
 * either be wrong (a reference or asset has to name something that exists) or
 * silently satisfy a check the editor is meant to prompt for.
 */
export function schemaDefaults(
  shape: Record<string, FieldSchema> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shape ?? {})
      .filter(([, field]) => field.default !== undefined)
      .map(([key, field]) => [key, field.default]),
  );
}

/**
 * Recursively replaces `Date` instances with ISO strings, the form the parsers
 * produce for every other format. Only TOML yields real dates, so an entry read
 * back from storage has to be normalized before it can be checked against the
 * reconstructed (string-based) schema.
 */
export function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(normalizeDates);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, normalizeDates(v)]),
    );
  }

  return value;
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
