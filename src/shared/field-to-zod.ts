import { z } from "zod";
import { isRecord, type FieldSchema } from "./field-schema.ts";
import {
  allowedLinks,
  containsLink,
  isLinkLike,
  LINK_DESCRIPTION,
  PLAIN_TEXT_MESSAGE,
} from "./links.ts";
import { ANCHOR_DESCRIPTION, anchorIds } from "./anchors.ts";

// Hoisted out of the refinement below so the check reuses one validator instead
// of building a fresh one per value.
const EMAIL = z.email();

// A value of no known shape can still hold text a component renders as a link.
const UNKNOWN = z.unknown().refine((value) => !containsLink(value), PLAIN_TEXT_MESSAGE);

/**
 * Rebuilds a live Zod validator from a serialized {@link FieldSchema}, the inverse
 * of `zodToFieldSchema`. The integration lowers each collection's schema in Node
 * and ships it in the manifest; here the browser reconstructs the schema so the
 * per-collection entry tools expose the real content model to the model as JSON
 * Schema and validate the agent's writes natively.
 *
 * Details the lowering could not capture (refinements, transforms) collapse to
 * their base type, so the reconstruction is a faithful view of the original
 * schema, stricter only by the link policy of `links.ts` that every string is
 * held to.
 */
function base(field: FieldSchema): z.ZodType {
  switch (field.type) {
    case "string": {
      let s = field.format === "url" ? z.url() : z.string();
      if (typeof field.minLength === "number") s = s.min(field.minLength);
      if (typeof field.maxLength === "number") s = s.max(field.maxLength);
      if (field.pattern) s = s.regex(new RegExp(field.pattern));

      // Zod's own email check, wrapped so the schema stays a plain string: its
      // lowered form is a ~130-character regex that no model needs to read and
      // that grammar-constrained samplers cannot compile. `url` lowers to a bare
      // `format`, so it passes through as it is.
      if (field.format === "email") {
        return s
          .refine((value) => EMAIL.safeParse(value).success, "Expected an email address.")
          .describe("Email address.");
      }

      // A declared URL has to be one a visitor may follow, and only a declared
      // one may be a URL at all (see `links.ts`).
      if (field.format === "url") return allowedLinks(s);
      if (field.format === "link") return allowedLinks(s).describe(LINK_DESCRIPTION);

      const text = s.refine((value) => !isLinkLike(value), PLAIN_TEXT_MESSAGE);

      return field.format === "anchor" ? anchorIds(text).describe(ANCHOR_DESCRIPTION) : text;
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

    case "enum": {
      if (field.options.length === 0) return z.never();

      if (field.options.every((option): option is string => typeof option === "string")) {
        return z.enum(field.options as [string, ...string[]]);
      }

      return z.literal(field.options);
    }

    case "literal":
      return z.literal(field.value);

    // Assets and references are stored as string paths / entry ids, so the field
    // alone tells the model nothing about what makes one valid. A short note
    // costs a few dozen bytes and saves the round trip a rejected write costs.
    case "image":
    case "file":
      return z
        .string()
        .describe(
          field.type === "image" && field.repoOnly
            ? "The `ref` of a repository media file, as listMedia reports it."
            : "The `ref` of a media file, as listMedia reports it.",
        );

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
        : z.array(UNKNOWN);

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
      return UNKNOWN;
  }
}

// The field's `.meta()` title and description, so an agent reading the JSON
// Schema sees what the form shows. A hint the base type carries, such as what
// a media `ref` is, follows the author's description rather than giving way to it.
function withMeta(schema: z.ZodType, { label, description }: FieldSchema): z.ZodType {
  const meta: { title?: string; description?: string } = {};

  if (label !== undefined) meta.title = label;
  if (description !== undefined)
    meta.description = [description, schema.description].filter(Boolean).join("\n");

  return Object.keys(meta).length ? schema.meta(meta) : schema;
}

// A FieldSchema is immutable serialized data, so the validator built from one is
// reusable for as long as it is reachable. That matters because reconstruction
// costs orders of magnitude more than the parse it enables, and the build walks
// the same handful of prop schemas once per component occurrence in every entry.
const cache = new WeakMap<FieldSchema, z.ZodType>();

/** Reconstructs a Zod schema for a single field, applying its modifier flags. */
export function fieldSchemaToZod(field: FieldSchema): z.ZodType {
  const cached = cache.get(field);

  if (cached) return cached;

  let schema = withMeta(base(field), field);

  if (field.nullable) schema = schema.nullable();
  if (field.optional) schema = schema.optional();
  if (field.default !== undefined) schema = schema.default(field.default);
  // Outermost, so it covers every other modifier: a caught field never fails,
  // which is the whole point of representing `.catch()` rather than peeling it.
  // The fallback is immaterial — every caller reads the issues, not the output.
  if (field.catch) schema = schema.catch(undefined as never);

  cache.set(field, schema);

  return schema;
}

/**
 * The variant of `schema` that `value` belongs to.
 * A discriminated union is resolved by its tag alone,
 * a plain union by the first variant that validates.
 */
export function activeVariant(
  schema: Extract<FieldSchema, { type: "union" }>,
  value: unknown,
): FieldSchema | undefined {
  const { discriminator, variants } = schema;

  if (discriminator) {
    if (!isRecord(value)) return undefined;

    return variants.find((variant) => {
      const tag = variant.type === "object" ? variant.shape[discriminator] : undefined;

      return tag !== undefined && fieldSchemaToZod(tag).safeParse(value[discriminator]).success;
    });
  }

  return variants.find((variant) => fieldSchemaToZod(variant).safeParse(value).success);
}
