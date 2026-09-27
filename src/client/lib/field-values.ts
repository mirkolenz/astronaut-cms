import { isRecord, isRequired, type FieldSchema } from "@/shared/field-schema";
import { activeVariant } from "@/shared/field-to-zod";
import { uniqueName } from "@/shared/paths";
import { toLabel } from "@/client/lib/to-label";

/** A value inside the values of a form, by field names, list indices and record keys. */
export type ValuePath = readonly (string | number)[];

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

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

/** The labels of the required fields of `shape` that have no value by `isEmpty`. */
export function missingFields(shape: Record<string, FieldSchema>, isEmpty: (key: string) => boolean): string[] {
  return Object.entries(shape)
    .filter(([key, field]) => isRequired(field) && isEmpty(key))
    .map(([key, field]) => fieldLabel(key, field));
}

// The object schema a value follows, the active variant for a union.
const objectOf = (field: FieldSchema, value: unknown) => (field.type === "union" ? activeVariant(field, value) : field);

/** The text that names a structured value, such as an item of a list. */
export function valueSummary(field: FieldSchema, value: unknown): string | undefined {
  const object = objectOf(field, value);

  return object?.type === "object" ? textSummary(object.shape, asRecord(value)) : undefined;
}

/** The labels of the required fields a structured value has no value for. */
export function missingValues(field: FieldSchema, value: unknown): string[] {
  const object = objectOf(field, value);
  const values = asRecord(value);
  const isEmpty = (key: string) => values[key] === undefined || values[key] === null || values[key] === "";

  return object?.type === "object" ? missingFields(object.shape, isEmpty) : [];
}

// Whether a field holds other fields, as opposed to a single value.
function isStructured(field: FieldSchema): boolean {
  switch (field.type) {
    case "object":
    case "array":
    case "record":
    case "tuple":
      return true;
    case "union":
      return field.variants.some(isStructured);
    default:
      return false;
  }
}

export type CollectionField = Extract<FieldSchema, { type: "array" | "record" }>;

/** The field as a list or record of structured items, which the inspector edits one at a time. */
export function collectionOf(field: FieldSchema): CollectionField | undefined {
  return (field.type === "array" || field.type === "record") && isStructured(itemField(field)) ? field : undefined;
}

export const itemField = (field: CollectionField): FieldSchema => (field.type === "array" ? field.element : field.value);

export type CollectionItem = readonly [key: string | number, value: unknown];

/** The items of a list by index, or of a record by key. */
export function collectionItems(field: CollectionField, value: unknown): CollectionItem[] {
  return field.type === "array" ? asArray(value).map((item, index) => [index, item]) : Object.entries(asRecord(value));
}

export function fromItems(field: CollectionField, items: readonly CollectionItem[]): unknown {
  return field.type === "array" ? items.map(([, item]) => item) : Object.fromEntries(items);
}

/** Keys that follow the items of a list through moves: their content, numbered among equal ones. */
export function contentKeys(items: readonly unknown[]): string[] {
  const seen = new Map<string, number>();

  return items.map((item) => {
    const content = JSON.stringify(item) ?? "";
    const count = seen.get(content) ?? 0;

    seen.set(content, count + 1);

    return `${count}:${content}`;
  });
}

/** A key for a new item of a record, numbered while `name` is taken. */
export const freeKey = (items: readonly CollectionItem[], name: string): string =>
  uniqueName(name, (key) => items.some(([taken]) => taken === key));

export interface FieldStep {
  key: string | number;
  field: FieldSchema;
  value: unknown;
  /** The field holding this one. */
  parent: FieldSchema;
}

function childField(parent: FieldSchema, value: unknown, key: string | number): FieldSchema | undefined {
  switch (parent.type) {
    case "object":
      return typeof key === "string" && Object.hasOwn(parent.shape, key) ? parent.shape[key] : undefined;
    case "record":
      return typeof key === "string" && Object.hasOwn(asRecord(value), key) ? parent.value : undefined;
    case "array":
      return typeof key === "number" && key < asArray(value).length ? parent.element : undefined;
    case "tuple":
      return typeof key === "number" ? parent.items[key] : undefined;
    case "union": {
      const variant = activeVariant(parent, value);

      return variant && childField(variant, value, key);
    }
    default:
      return undefined;
  }
}

/** The fields along a path through the values of a form, or `undefined` if it leads nowhere. */
export function fieldsAlong(
  shape: Record<string, FieldSchema>,
  values: Record<string, unknown>,
  path: ValuePath,
): FieldStep[] | undefined {
  const steps: FieldStep[] = [];
  let parent: FieldSchema = { type: "object", shape };
  let value: unknown = values;

  for (const key of path) {
    const field = childField(parent, value, key);

    if (!field) return undefined;

    value = typeof key === "number" ? asArray(value)[key] : asRecord(value)[key];
    steps.push({ key, field, value, parent });
    parent = field;
  }

  return steps;
}

/** A copy of `root` with the value at `path` replaced, copying only what lies on the way. */
export function setAt(root: unknown, path: ValuePath, value: unknown): unknown {
  const [key, ...rest] = path;

  if (key === undefined) return value;

  if (typeof key === "number") {
    const copy = [...asArray(root)];

    copy[key] = setAt(copy[key], rest, value);

    return copy;
  }

  const record = asRecord(root);

  return { ...record, [key]: setAt(record[key], rest, value) };
}

/** What a variant of a union is called: the value of its discriminator, else its position. */
export function variantLabel(union: Extract<FieldSchema, { type: "union" }>, index: number): string {
  const variant = union.variants[index];
  const tag = union.discriminator && variant?.type === "object" ? variant.shape[union.discriminator] : undefined;

  return tag?.type === "literal" ? String(tag.value) : String(index);
}
