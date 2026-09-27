import type { FieldSchema } from "@shared/field-schema";

// Walks a (FieldSchema, value) pair in tandem and collects every leaf that holds
// a path to another resource: a cross-collection `reference` or an `image`/`file`
// asset. These are the fields the lowered schema can only type as `string`, so
// their targets need a separate existence check.

export interface ResolvableLeaf {
  kind: "reference" | "image" | "file";
  /** Target collection, present only for references. */
  collection?: string;
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

function matchesTag(field: FieldSchema | undefined, tag: unknown): boolean {
  return field?.type === "literal" && field.value === tag;
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
    case "file":
      return typeof value === "string" && value !== "" ? [{ kind: schema.type, value, path }] : [];

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
      // Only a discriminated union can be resolved to a single variant from the
      // value; a plain union is ambiguous, so descend no further.
      const discriminator = schema.discriminator;

      if (discriminator && isRecord(value)) {
        const tag = value[discriminator];
        const variant = schema.variants.find(
          (v) => v.type === "object" && matchesTag(v.shape[discriminator], tag),
        );

        return variant ? collectResolvableLeaves(variant, value, path) : [];
      }

      return [];
    }

    default:
      return [];
  }
}
