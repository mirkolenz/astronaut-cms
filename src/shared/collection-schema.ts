import { z } from "zod";
import {
  CONTENT_FORMATS,
  DATA_FORMATS,
  asEntryFormat,
  extractFormatsFromLoader,
  type CollectionManifest,
  type CollectionManifestEntry,
  type EntryFormat,
} from "@/shared/types";
import type { FieldSchema } from "@/shared/field-schema";
import { fieldSchemaToZod } from "@/shared/field-to-zod";
import { diagnostic, type Diagnostic } from "@/shared/diagnostics";

/**
 * Collection-shaped Zod schemas, built on the shared {@link fieldSchemaToZod}
 * reconstruction: the full frontmatter schema for an overwrite, the all-optional
 * one for a patch, and the small helpers the editor and the agent tools need
 * around them.
 */

/**
 * The names a collection may be called, as a schema. The set is fixed at build
 * time, so an unknown name is refused wherever one is accepted, at the server's
 * operation boundary, where it used to resolve to the conventional directory for
 * that name and quietly read somebody else's files, and in the tools an agent
 * sees, where it is also the list of what exists.
 *
 * Takes the manifest rather than importing it, because this module is reached
 * from the integration, which runs before the virtual module exists.
 */
export function collectionEnum(manifest: CollectionManifest): z.ZodType<string, string> {
  const names = Object.keys(manifest);

  return names.length ? z.enum(names as [string, ...string[]]) : z.never();
}

// In a patch every field is optional (omitted = unchanged) and nullable (null =
// remove); its default is dropped so an omitted field is never silently auto-filled.
function patchField(field: FieldSchema): z.ZodType {
  return fieldSchemaToZod({ ...field, default: undefined })
    .nullable()
    .optional();
}

// Data without a schema is still content, so it is held to the same link policy.
const UNTYPED_DATA: FieldSchema = { type: "record", value: { type: "unknown" } };

/**
 * Full data/frontmatter schema for a collection, for a complete overwrite. Falls
 * back to a free record, still link-checked, only when the collection declares
 * no schema.
 */
export function collectionDataSchema(
  col: CollectionManifestEntry,
): z.ZodType<Record<string, unknown>> {
  const schema = fieldSchemaToZod(col.schema ?? UNTYPED_DATA);

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

  return fieldSchemaToZod(UNTYPED_DATA) as z.ZodType<Record<string, unknown>>;
}

/**
 * Starting data for a new entry: the defaults the schema declares and nothing
 * else. Required fields are deliberately left empty. A synthesized value would
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
function normalizeDates(value: unknown): unknown {
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
export function collectionFormatEnum(col: CollectionManifestEntry): z.ZodType<EntryFormat> {
  // A loader may name an extension the CMS has no parser for (a custom loader,
  // a `.mdoc` variant); those are dropped rather than offered as a format an
  // entry could be saved in.
  const declared = (extractFormatsFromLoader(col.loaderPattern, col.loaderFileName) ?? [])
    .map(asEntryFormat)
    .filter((format): format is EntryFormat => format !== null);
  const resolved = declared.length
    ? declared
    : col.type === "data"
      ? DATA_FORMATS
      : CONTENT_FORMATS;

  return z.enum(resolved as [EntryFormat, ...EntryFormat[]]);
}

/**
 * The data must satisfy the collection's own schema. Writing an entry that does
 * not is the one CMS mistake the site cannot survive: Astro's content sync
 * throws on it, and the full sync it runs at startup is uncaught, so the dev
 * server exits and will not come back until the file is fixed by hand.
 *
 * The reconstructed schema is never stricter than the original (see
 * `fieldSchemaToZod`) except for the link policy of `links.ts`, so this catches
 * every structural violation while blocking nothing else the real schema would
 * have accepted.
 */
export function validateAgainstSchema(
  col: CollectionManifestEntry,
  data: Record<string, unknown>,
): Diagnostic[] {
  const result = collectionDataSchema(col).safeParse(normalizeDates(data));

  if (result.success) return [];

  return result.error.issues.map((issue) =>
    diagnostic(issue.message, issue.path.join(".") || undefined),
  );
}
