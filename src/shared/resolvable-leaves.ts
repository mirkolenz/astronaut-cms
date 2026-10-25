import { isRecord, type FieldSchema } from "@/shared/field-schema";
import { activeVariant } from "@/shared/field-to-zod";

// Walks a (FieldSchema, value) pair in tandem and collects every leaf that holds
// a path to another resource, a cross-collection `reference`, an `image`/`file`
// asset or a `link`, and every `anchor` a link may target. These are the fields
// the lowered schema can only type as `string`, so their targets need a separate
// existence check.

export interface ResolvableLeaf {
  kind: "reference" | "image" | "file" | "link" | "anchor";
  /** Target collection, present only for references. */
  collection?: string;
  /** An image field astro types as imported, which only a repository file satisfies. */
  repoOnly?: true;
  value: string;
  path: string;
}

/** Whether a leaf names a file of a media library. */
export const isAsset = (leaf: ResolvableLeaf): boolean =>
  leaf.kind === "image" || leaf.kind === "file";

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

    case "string":
      return (schema.format === "link" || schema.format === "anchor") &&
        typeof value === "string" &&
        value !== ""
        ? [{ kind: schema.format, value, path }]
        : [];

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
      const variant = activeVariant(schema, value);

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
