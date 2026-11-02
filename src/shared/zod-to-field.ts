/**
 * Lowers a live Zod v4 schema into a serializable {@link FieldSchema}. Runs in
 * Node (content collections) and in the browser (CMS component props); the
 * resulting plain object is what crosses the boundary, so no Zod instance ever
 * does.
 *
 * Introspection goes entirely through Zod's public surface: `instanceof` against
 * the exported schema classes, their public accessors (`.unwrap()`, `.options`,
 * `.element`, `.shape`, `.valueType`, `.meta()`), the public typed `.def`, and
 * `z.toJSONSchema()` for declarative constraints (min/max, regex, multipleOf, ...).
 */
import { z } from "zod";
import {
  CMS_IMAGE,
  CMS_FILE,
  CMS_REFERENCE,
  CMS_LINK,
  CMS_ANCHOR,
  type FieldMeta,
  type FieldMods,
  type FieldSchema,
  isRecord,
} from "./field-schema.ts";

// Bounds recursion through `z.lazy` and pathologically deep schemas: a
// self-referential schema would otherwise expand forever. Past this depth the
// field degrades to "unknown" (raw editor) rather than blowing the stack.
const MAX_DEPTH = 10;

/** Lowers a (live) Zod v4 schema into a serializable {@link FieldSchema}. */
export function zodToFieldSchema(schema: unknown): FieldSchema {
  return lower(schema, 0);
}

function lower(input: unknown, depth: number): FieldSchema {
  if (depth > MAX_DEPTH) return { type: "unknown" };

  const mods: FieldMods = {};
  const meta: FieldMeta = {};
  let schema: unknown = input;

  // Peel wrappers via their public accessors, outermost first: every modifier
  // records itself only if it is not already set, so the outermost occurrence of
  // each is the one that wins. `.nonoptional()` is how a schema takes back an
  // `.optional()` further in, which is why it writes the same flag. Only
  // `readonly` is fully transparent; `pipe` keeps its output side.
  while (schema instanceof z.ZodType) {
    readMeta(schema, meta);

    if (schema instanceof z.ZodOptional) {
      if (!("optional" in mods)) mods.optional = true;
      schema = schema.unwrap();
    } else if (schema instanceof z.ZodNonOptional) {
      if (!("optional" in mods)) mods.optional = false;
      schema = schema.unwrap();
    } else if (schema instanceof z.ZodNullable) {
      mods.nullable = true;
      schema = schema.unwrap();
    } else if (schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault) {
      if (!("default" in mods)) mods.default = schema.def.defaultValue;
      schema = schema.unwrap();
    } else if (schema instanceof z.ZodCatch) {
      mods.catch = true;
      schema = schema.unwrap();
    } else if (schema instanceof z.ZodPipe) {
      schema = schema.out;
    } else if (schema instanceof z.ZodReadonly) {
      schema = schema.unwrap();
    } else {
      break;
    }
  }

  const base = convertBase(schema, depth);
  if (mods.optional) base.optional = true;
  if (mods.nullable) base.nullable = true;
  if ("default" in mods) base.default = mods.default;
  if (mods.catch) base.catch = true;

  return Object.assign(base, meta);
}

// The presentation keys of `.meta()`, outermost first like the modifiers, so
// `z.string().meta({ title }).optional()` and `z.string().optional().meta({ title })`
// read the same.
function readMeta(schema: z.ZodType, meta: FieldMeta): void {
  const data = schema.meta();

  if (typeof data?.title === "string") meta.label ??= data.title;
  if (typeof data?.description === "string") meta.description ??= data.description;
  if (typeof data?.group === "string") meta.group ??= data.group;
  if (data?.multiline === true) meta.multiline ??= true;
  if (isStringRecord(data?.labels)) meta.labels ??= data.labels;
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((label) => typeof label === "string");

// Coerces a Zod literal value into the JSON-safe subset `FieldSchema` allows.
function literalValue(value: unknown): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  throw new Error("CMS schema literals must be strings, numbers, booleans, or null.");
}

// Reads a schema's declarative constraints (min/max, regex, multipleOf, ...) via
// Zod's public `toJSONSchema` projection rather than its internal check list, so
// the lowering tracks the documented API. `unrepresentable: "any"` keeps an inner
// type Zod can't project (a Date, a transform) from throwing, and any other
// failure degrades to an empty schema, i.e. no constraints captured.
function constraintsOf(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { unrepresentable: "any" });
  } catch {
    return {};
  }
}

// `z.int()` advertises the JS safe-integer range as its bounds; those sentinels
// are not real user constraints, so they are dropped.
function realBound(value: unknown, sentinel: number): number | undefined {
  return typeof value === "number" && value !== sentinel ? value : undefined;
}

function convertBase(schema: unknown, depth: number): FieldSchema {
  if (!(schema instanceof z.ZodType)) return { type: "unknown" };

  const meta = schema.meta();
  if (meta?.[CMS_IMAGE] === "repo") return { type: "image", repoOnly: true };
  if (meta?.[CMS_IMAGE]) return { type: "image" };
  if (meta?.[CMS_FILE]) return { type: "file" };
  if (meta?.[CMS_LINK]) return { type: "string", format: "link" };

  const ref = meta?.[CMS_REFERENCE];
  if (typeof ref === "string") return { type: "reference", collection: ref };

  const next = depth + 1;

  // `z.email()` / `z.url()` are dedicated `ZodStringFormat` classes; plain strings
  // are `ZodString`. The JSON Schema projection surfaces length, the email/uri
  // format, and an explicit `.regex()` (or startsWith/endsWith) as `pattern`.
  if (schema instanceof z.ZodString || schema instanceof z.ZodStringFormat) {
    const js = constraintsOf(schema);
    const field: FieldSchema = { type: "string" };
    if (js.format === "email") field.format = "email";
    else if (js.format === "uri") field.format = "url";
    if (typeof js.minLength === "number") field.minLength = js.minLength;
    if (typeof js.maxLength === "number") field.maxLength = js.maxLength;
    // A formatted string implies its own pattern; only keep an explicit regex.
    if (!field.format && typeof js.pattern === "string") field.pattern = js.pattern;
    // An anchor is plain text the CMS also reads as the target of a link.
    if (meta?.[CMS_ANCHOR]) field.format = "anchor";
    return field;
  }

  // `ZodNumberFormat` (the integer variants z.int / int32 / int64 / safeint)
  // extends `ZodNumber`, so this catches both. Integers project to JSON Schema
  // `type: "integer"`; bounds and `multipleOf` project to the numeric keywords.
  if (schema instanceof z.ZodNumber) {
    const js = constraintsOf(schema);
    const field: FieldSchema = { type: "number" };
    if (js.type === "integer") field.integer = true;
    const min = realBound(js.minimum, Number.MIN_SAFE_INTEGER);
    const max = realBound(js.maximum, Number.MAX_SAFE_INTEGER);
    if (min !== undefined) field.min = min;
    if (max !== undefined) field.max = max;
    if (typeof js.exclusiveMinimum === "number") field.exclusiveMin = js.exclusiveMinimum;
    if (typeof js.exclusiveMaximum === "number") field.exclusiveMax = js.exclusiveMaximum;
    if (typeof js.multipleOf === "number") field.multipleOf = js.multipleOf;
    return field;
  }

  if (schema instanceof z.ZodBoolean) return { type: "boolean" };

  if (schema instanceof z.ZodDate) return { type: "date" };

  if (schema instanceof z.ZodEnum)
    return { type: "enum", options: schema.options.map(literalValue) };

  if (schema instanceof z.ZodLiteral) {
    // A multi-value literal is just a union of single literals; lower it that
    // way for a uniform shape.
    const values = schema.def.values;
    if (values.length > 1) {
      return {
        type: "union",
        variants: values.map((value) => ({ type: "literal", value: literalValue(value) })),
      };
    }
    return { type: "literal", value: literalValue(values[0]) };
  }

  if (schema instanceof z.ZodArray) {
    const js = constraintsOf(schema);
    const field: FieldSchema = { type: "array", element: lower(schema.element, next) };
    if (typeof js.minItems === "number") field.minItems = js.minItems;
    if (typeof js.maxItems === "number") field.maxItems = js.maxItems;
    return field;
  }

  if (schema instanceof z.ZodTuple) {
    return { type: "tuple", items: schema.def.items.map((item) => lower(item, next)) };
  }

  if (schema instanceof z.ZodObject) {
    const shape: Record<string, FieldSchema> = {};
    for (const [key, value] of Object.entries(schema.shape)) shape[key] = lower(value, next);
    return { type: "object", shape };
  }

  if (schema instanceof z.ZodRecord)
    return { type: "record", value: lower(schema.valueType, next) };

  if (schema instanceof z.ZodUnion) {
    // `ZodDiscriminatedUnion` extends `ZodUnion`; its discriminator drives the
    // dedicated variant editor. A plain union has none.
    const variants = schema.options.map((option) => lower(option, next));
    const discriminator =
      schema instanceof z.ZodDiscriminatedUnion ? schema.def.discriminator : undefined;
    return typeof discriminator === "string"
      ? { type: "union", discriminator, variants }
      : { type: "union", variants };
  }

  if (schema instanceof z.ZodIntersection) {
    // Flatten an intersection of two object schemas into one merged object so
    // both the form and the agent see a single field map. Non-object operands
    // have no faithful flat shape, so they degrade to "unknown".
    const left = lower(schema.def.left, next);
    const right = lower(schema.def.right, next);
    if (left.type === "object" && right.type === "object") {
      return { type: "object", shape: { ...left.shape, ...right.shape } };
    }
    return { type: "unknown" };
  }

  if (schema instanceof z.ZodLazy) return lower(schema.unwrap(), next);

  return { type: "unknown" };
}
