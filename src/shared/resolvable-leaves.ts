import type { FieldSchema } from "./field-schema";
import { fieldSchemaToZod } from "@/shared/field-to-zod";

// Walks a (FieldSchema, value) pair in tandem and collects every leaf that holds
// a path to another resource: a cross-collection `reference` or an `image`/`file`
// asset. These are the fields the lowered schema can only type as `string`, so
// their targets need a separate existence check.

export interface ResolvableLeaf {
  kind: "reference" | "image" | "file";
  /** Target collection, present only for references. */
  collection?: string;
  /** An image field astro types as imported, which only a repository file satisfies. */
  repoOnly?: true;
  value: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function child(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;

  return path ? `${path}.${key}` : key;
}

export function collectResolvableLeaves(
  schema: FieldSchema,
  value: unknown,
  path = "",
): ResolvableLeaf[] {
  if (value === null || value === undefined) return [];

  switch (schema.type) {
    case "reference":
      return typeof value === "string" && value !== ""
        ? [{ kind: "reference", collection: schema.collection, value, path }]
        : [];

    case "image":
      return typeof value === "string" && value !== ""
        ? [{ kind: "image", value, path, ...(schema.repoOnly && { repoOnly: true }) }]
        : [];

    case "file":
      return typeof value === "string" && value !== "" ? [{ kind: "file", value, path }] : [];

    case "object":
      return isRecord(value)
        ? Object.entries(schema.shape).flatMap(([key, field]) =>
            collectResolvableLeaves(field, value[key], child(path, key)),
          )
        : [];

    case "array":
      return Array.isArray(value)
        ? value.flatMap((item, i) => collectResolvableLeaves(schema.element, item, child(path, i)))
        : [];

    case "tuple":
      return Array.isArray(value)
        ? schema.items.flatMap((field, i) =>
            collectResolvableLeaves(field, value[i], child(path, i)),
          )
        : [];

    case "record":
      return isRecord(value)
        ? Object.entries(value).flatMap(([key, item]) =>
            collectResolvableLeaves(schema.value, item, child(path, key)),
          )
        : [];

    case "union": {
      const variant = schema.variants.find((candidate) =>
        fieldSchemaToZod(candidate).safeParse(value).success,
      );

      return variant ? collectResolvableLeaves(variant, value, path) : [];
    }

    default:
      return [];
  }
}

/**
 * The assets and references an entry's data points at. A schema that is not an
 * object holds no fields to walk, which is the only shape a collection's data
 * can take.
 */
export function dataLeaves(
  schema: FieldSchema | null | undefined,
  data: Record<string, unknown>,
): ResolvableLeaf[] {
  return schema?.type === "object" ? collectResolvableLeaves(schema, data) : [];
}
