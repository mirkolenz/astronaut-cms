import { isRequired, type FieldSchema } from "@/shared/field-schema";
import { toLabel } from "@/client/lib/to-label";

/** The value a new field starts with: its default, null when it may be left out, else an empty value. */
export function getDefaultValue(schema?: FieldSchema): unknown {
  if (!schema) return "";

  if (schema.default !== undefined) return schema.default;
  if (schema.optional || schema.nullable) return null;

  switch (schema.type) {
    case "string":
    case "image":
    case "file":
    case "reference":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "date":
      return new Date().toISOString();
    case "enum":
      return schema.options.length > 0 ? schema.options[0] : "";
    case "literal":
      return schema.value;
    case "array":
      return [];
    case "tuple":
      return schema.items.map((item) => getDefaultValue(item));
    case "record":
      return {};
    case "object": {
      const obj: Record<string, unknown> = {};

      for (const [key, fieldSchema] of Object.entries(schema.shape)) {
        if (!fieldSchema.optional) obj[key] = getDefaultValue(fieldSchema);
      }

      return obj;
    }
    case "union":
      return schema.variants[0] ? getDefaultValue(schema.variants[0]) : {};
    default:
      return "";
  }
}

/**
 * The text that names an object, such as a component or an array item: the
 * `preferred` field when given, else the first required plain text field with a
 * value, else any plain text field with one.
 */
export function textSummary(
  shape: Record<string, FieldSchema>,
  values: Record<string, unknown>,
  preferred?: string | null,
): string | undefined {
  const text = (key: string) => {
    const value = values[key];

    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  if (preferred) return text(preferred);

  const keys = Object.entries(shape)
    .filter(([, field]) => field.type === "string" && !field.format)
    .map(([key, field]) => ({ key, required: isRequired(field) }));

  return [...keys.filter(({ required }) => required), ...keys].map(({ key }) => text(key)).find(Boolean);
}

/** What a field is called in the form: its `title`, else its key in words. */
export function fieldLabel(key: string, field: FieldSchema): string {
  return field.label ?? toLabel(key);
}
