import i18n from "i18next";
import { isRecord, isRequired, type FieldSchema } from "@/shared/field-schema";
import { activeVariant } from "@/shared/field-to-zod";
import { uniqueName } from "@/shared/paths";
import { toLabel } from "@/shared/labels";

/** A value inside the values of a form, by field names, list indices and record keys. */
export type ValuePath = readonly (string | number)[];

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** Whether a field has no value, as an empty text has none. */
export const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

const TEXT_TYPES: readonly FieldSchema["type"][] = ["string", "date", "image", "file", "reference"];
// The fields whose input shows no value as an empty text.
const SHOWS_EMPTY_TEXT = new Set(TEXT_TYPES);
// The fields whose control shows that they have no value: the text inputs and a few more.
const SHOWS_EMPTY = new Set<FieldSchema["type"]>([...TEXT_TYPES, "number", "enum", "unknown"]);

/** Whether a field's control shows that it has no value, so none needs setting first. */
export const showsEmpty = (field: FieldSchema): boolean => SHOWS_EMPTY.has(field.type);

/** Whether a field may do without a value, being left out or null. */
export const isUnsettable = (field: FieldSchema): boolean =>
  field.optional === true || field.nullable === true;

/**
 * What a field holds once emptied or cleared: `null` where it may be null,
 * nothing where it may be left out, falls back to a default, or has no empty text,
 * else an empty text.
 */
export function emptyValue(field: FieldSchema): unknown {
  if (field.nullable) return null;

  return !isRequired(field) || !SHOWS_EMPTY_TEXT.has(field.type) ? undefined : "";
}

/** The value a field that may do without one gets once it is set, as if it had to have one. */
export const seedValue = (field: FieldSchema): unknown =>
  getDefaultValue({ ...field, optional: false, nullable: false });

/** The value a new field starts with: its default, null when it may be left out, else an empty value. */
export function getDefaultValue(schema?: FieldSchema): unknown {
  if (!schema) return "";

  if (schema.default !== undefined) return schema.default;
  if (isUnsettable(schema)) return null;

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

  return [...keys.filter(({ required }) => required), ...keys]
    .map(({ key }) => text(key))
    .find(Boolean);
}

/** What a field is called in the form: its `title`, else its key in words. */
export function fieldLabel(key: string, field: FieldSchema): string {
  return field.label ?? toLabel(key);
}

/** The labels of the required fields of `shape` that have no value by `isEmpty`. */
export function missingFields(
  shape: Record<string, FieldSchema>,
  isEmpty: (key: string) => boolean,
): string[] {
  return Object.entries(shape)
    .filter(([key, field]) => isRequired(field) && isEmpty(key))
    .map(([key, field]) => fieldLabel(key, field));
}

// The object schema a value follows, the active variant for a union.
const objectOf = (field: FieldSchema, value: unknown) =>
  field.type === "union" ? activeVariant(field, value) : field;

/** The text that names a structured value, such as an item of a list. */
export function valueSummary(field: FieldSchema, value: unknown): string | undefined {
  const object = objectOf(field, value);

  return object?.type === "object" ? textSummary(object.shape, asRecord(value)) : undefined;
}

/** The labels of the required fields a structured value has no value for. */
export function missingValues(field: FieldSchema, value: unknown): string[] {
  const object = objectOf(field, value);
  const values = asRecord(value);

  return object?.type === "object"
    ? missingFields(object.shape, (key) => isBlank(values[key]))
    : [];
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
  return (field.type === "array" || field.type === "record") && isStructured(itemField(field))
    ? field
    : undefined;
}

export const itemField = (field: CollectionField): FieldSchema =>
  field.type === "array" ? field.element : field.value;

export type CollectionItem = readonly [key: string | number, value: unknown];

/** The items of a list by index, or of a record by key. */
export function collectionItems(field: CollectionField, value: unknown): CollectionItem[] {
  return field.type === "array"
    ? asArray(value).map((item, index) => [index, item])
    : Object.entries(asRecord(value));
}

/** The labels of the required fields that any of a collection's items has no value for. */
export function collectionMissing(
  field: CollectionField,
  items: readonly CollectionItem[],
): string[] {
  const item = itemField(field);

  return [...new Set(items.flatMap(([, value]) => missingValues(item, value)))];
}

export function fromItems(field: CollectionField, items: readonly CollectionItem[]): unknown {
  return field.type === "array" ? items.map(([, item]) => item) : Object.fromEntries(items);
}

/** What an item of a collection is called: its key in a record, else its summary, else its place. */
export function itemLabel(field: CollectionField, [key, value]: CollectionItem): string {
  if (typeof key === "string") return key;

  return (
    valueSummary(itemField(field), value) ??
    i18n.t(($) => $.editors.item, { index: String(key + 1) })
  );
}

// A row shows no more items than this, so the rest are never labelled.
const SUMMARY_ITEMS = 5;

/** The first items of a collection named on one line. */
export const collectionSummary = (
  field: CollectionField,
  items: readonly CollectionItem[],
): string =>
  items
    .slice(0, SUMMARY_ITEMS)
    .map((item) => itemLabel(field, item))
    .join(", ");

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

export interface ItemKey {
  key: string;
  content: string;
}

/**
 * Keys that follow the items of a list through any change, such as a move undone or an edit.
 * An item keeps the key of an equal one, else of the one in its place, else gets a new one,
 * and an unchanged list gives back `before` itself.
 */
export function followKeys(
  before: readonly ItemKey[],
  items: readonly unknown[],
): readonly ItemKey[] {
  const contents = items.map((item) => JSON.stringify(item) ?? "");

  if (contents.length === before.length && contents.every((c, i) => c === before[i]?.content)) {
    return before;
  }

  // An item still in its place keeps its key first, so an edit never hands it to an equal item.
  const kept = contents.map((content, index) =>
    before[index]?.content === content ? index : undefined,
  );
  const taken = new Set(kept);
  const unused = Map.groupBy(
    [...before.keys()].filter((index) => !taken.has(index)),
    (index) => before[index]?.content ?? "",
  );
  const matched = contents.map((content, index) => kept[index] ?? unused.get(content)?.shift());

  for (const index of matched) taken.add(index);

  return contents.map((content, index) => {
    const from = matched[index] ?? (taken.has(index) ? undefined : index);

    return { content, key: (from !== undefined && before[from]?.key) || crypto.randomUUID() };
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

function childField(
  parent: FieldSchema,
  value: unknown,
  key: string | number,
): FieldSchema | undefined {
  switch (parent.type) {
    case "object":
      return typeof key === "string" && Object.hasOwn(parent.shape, key)
        ? parent.shape[key]
        : undefined;
    case "record":
      return typeof key === "string" && Object.hasOwn(asRecord(value), key)
        ? parent.value
        : undefined;
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
export function variantLabel(
  union: Extract<FieldSchema, { type: "union" }>,
  index: number,
): string {
  const variant = union.variants[index];
  const tag =
    union.discriminator && variant?.type === "object"
      ? variant.shape[union.discriminator]
      : undefined;

  return tag?.type === "literal" ? String(tag.value) : String(index);
}

/** A union's value switched to its variant at `index`, keeping the values both variants take alike. */
export function switchVariant(
  union: Extract<FieldSchema, { type: "union" }>,
  value: unknown,
  index: number,
): unknown {
  const variant = union.variants[index];
  const before = activeVariant(union, value);

  if (!variant) return value;

  const next = getDefaultValue(variant);

  if (variant.type !== "object" || before?.type !== "object" || !isRecord(next)) return next;

  const kept = Object.entries(asRecord(value)).filter(
    ([key]) =>
      key !== union.discriminator &&
      Object.hasOwn(variant.shape, key) &&
      variant.shape[key]?.type === before.shape[key]?.type,
  );

  return { ...next, ...Object.fromEntries(kept) };
}
