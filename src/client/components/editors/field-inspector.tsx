/**
 * The values of a form that open in the inspector: a list or record of
 * structured items to reorder and add to, and each of its items to edit on its
 * own. It works the same for the fields of an entry and the props of a
 * component, with breadcrumbs leading back to the fields.
 */
import { useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n, { type TFunction } from "i18next";
import type { FieldSchema } from "@/shared/field-schema";
import { fieldSchemaToZod } from "@/shared/field-to-zod";
import { arrayMove } from "@/client/lib/arrays";
import { clipboardActions, movesWithin, type BlockActions } from "@/client/lib/block-editing";
import { readClipboard } from "@/client/lib/editor-content";
import {
  asRecord,
  collectionItems,
  collectionMissing,
  collectionOf,
  contentKeys,
  fieldLabel,
  fieldsAlong,
  freeKey,
  fromItems,
  getDefaultValue,
  itemField,
  missingValues,
  setAt,
  valueSummary,
  variantLabel,
  type CollectionField,
  type CollectionItem,
  type FieldStep,
  type ValuePath,
} from "@/client/lib/field-values";
import { select, useFormField } from "@/client/stores/inspector-store";
import { setField, useForm, useForms, type Form } from "@/client/stores/form-store";
import { uniqueName } from "@/shared/paths";
import { toast } from "@/client/components/toast";
import {
  FieldList,
  FieldNavContext,
  FieldRenderer,
  NewKeyInput,
} from "@/client/components/editors/field-renderer";
import {
  AddMenu,
  BlockList,
  InspectorView,
  ListControls,
  type AddOption,
  type InspectorCrumb,
} from "@/client/components/editors/block-controls";

interface FormProps {
  shape: Record<string, FieldSchema>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

// How the values of a form on the page open in the inspector.
const openField = (id: string, field: ValuePath) =>
  select(field.length > 0 ? { form: id } : null, { field });

const formNav = (id: string, selected: ValuePath) => ({
  selected,
  open: (field: ValuePath) => openField(id, field),
});

/** The fields of a form on the page, such as those of an entry. */
export function EntryFields({ form: id }: { form: string }) {
  const form = useForm(id);
  const selected = useFormField(id);

  return (
    form && (
      <FieldNavContext.Provider value={formNav(id, selected)}>
        <FieldList
          shape={form.shape}
          values={form.values}
          onChange={(key, value) => setField(id, key, value)}
        />
      </FieldNavContext.Provider>
    )
  );
}

// The fields of a form that open in the inspector, lists or records of structured items.
const formCollections = ({ shape }: Form) =>
  Object.entries(shape).flatMap(([key, field]) => {
    const collection = collectionOf(field);

    return collection ? [{ key, collection }] : [];
  });

/** Whether a form on the page has fields that open in the inspector, which changes with its schema only. */
export const useHasFormOutline = (): boolean =>
  useForms((forms) =>
    Object.values(forms).some(({ shape }) =>
      Object.values(shape).some((field) => collectionOf(field)),
    ),
  );

/** The fields of the forms on the page that open in the inspector, while nothing is selected. */
export function FormOutline() {
  const { t } = useTranslation();
  const forms = useForms((forms) => forms);

  return Object.entries(forms).map(([id, form]) => {
    const collections = formCollections(form);

    return (
      collections.length > 0 && (
        <BlockList
          key={id}
          title={form.label}
          items={collections}
          getKey={({ key }) => key}
          row={({ key, collection }) => {
            const items = collectionItems(collection, form.values[key]);

            return {
              label: fieldLabel(key, collection),
              summary: t(($) => $.editors.items, { count: items.length }),
              missing: collectionMissing(collection, items),
              onOpen: () => openField(id, [key]),
              inspects: true,
            };
          }}
        />
      )
    );
  });
}

/** A value of a form on the page that its fields have opened. */
export function FormInspector({ form: id, field }: { form: string; field: ValuePath }) {
  const form = useForm(id);

  return (
    form && (
      <FieldNavContext.Provider value={formNav(id, field)}>
        <FieldInspector
          crumbs={[]}
          label={form.label}
          shape={form.shape}
          values={form.values}
          onChange={(key, value) => setField(id, key, value)}
        />
      </FieldNavContext.Provider>
    )
  );
}

function itemLabel(
  collection: CollectionField,
  key: string | number,
  value: unknown,
  t: TFunction,
): string {
  if (typeof key === "string") return key;

  return (
    valueSummary(itemField(collection), value) ??
    t(($) => $.editors.item, { index: String(key + 1) })
  );
}

function stepLabel(step: FieldStep, t: TFunction): string {
  const collection = collectionOf(step.parent);

  return collection
    ? itemLabel(collection, step.key, step.value, t)
    : fieldLabel(String(step.key), step.field);
}

// What the inspector opens: a collection, or one of its items.
const opens = (step: FieldStep) => collectionOf(step.field) || collectionOf(step.parent);

// The kinds of items a list takes: the variants of a union, as a structured component takes its children.
function addOptions(item: FieldSchema): AddOption[] {
  return item.type === "union" && item.discriminator
    ? item.variants.map((_, index) => ({ key: String(index), label: variantLabel(item, index) }))
    : [{ key: "", label: item.label }];
}

/** The items on the clipboard that fit a collection, as the JSON of one item or of several. */
function pastedItems(collection: CollectionField, items: readonly CollectionItem[], text: string) {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    toast(
      i18n.t(($) => $.editors.pasteInvalid),
      "error",
    );

    return undefined;
  }

  const item = fieldSchemaToZod(itemField(collection));
  const fits = (candidate: unknown) => item.safeParse(candidate).success;
  const taken = new Set(items.map(([key]) => key));
  const pasted: CollectionItem[] =
    collection.type === "array"
      ? (fits(value) || !Array.isArray(value) ? [value] : value).map((entry, index) => [
          items.length + index,
          entry,
        ])
      : Object.entries(asRecord(value)).map(([name, entry]) => {
          const key = uniqueName(name, (candidate) => taken.has(candidate));

          taken.add(key);

          return [key, entry];
        });

  if (pasted.length === 0 || !pasted.every(([, entry]) => fits(entry))) {
    toast(
      i18n.t(($) => $.editors.pasteUnfit),
      "error",
    );

    return undefined;
  }

  return pasted;
}

/** How the item at `path` moves and goes among the items of its collection, the value `list`. */
function itemActions(
  step: FieldStep,
  list: unknown,
  path: ValuePath,
  setAtPath: (path: ValuePath, value: unknown) => void,
  open: (path: ValuePath) => void,
): BlockActions | undefined {
  const collection = collectionOf(step.parent);

  if (!collection) return undefined;

  const listPath = path.slice(0, -1);
  const items = collectionItems(collection, list);
  const index = items.findIndex(([key]) => key === step.key);
  const isList = collection.type === "array";
  const set = (next: readonly CollectionItem[]) => setAtPath(listPath, fromItems(collection, next));

  return clipboardActions(
    {
      move: movesWithin(items.length, index, (to) => {
        set(arrayMove(items, index, to));
        open([...listPath, isList ? to : step.key]);
      }),
      duplicate: () => {
        const key = isList ? index + 1 : freeKey(items, String(step.key));

        set(items.toSpliced(index + 1, 0, [key, structuredClone(step.value)]));
      },
      remove: () => {
        set(items.toSpliced(index, 1));
        open(listPath);
      },
    },
    () => JSON.stringify(isList ? step.value : { [step.key]: step.value }, null, 2),
  );
}

/**
 * The value of a form its fields have opened. `label` names the fields, the
 * way back to them, after the `crumbs` that lead to the form itself.
 */
export function FieldInspector({
  crumbs,
  label,
  shape,
  values,
  onChange,
}: FormProps & { crumbs: readonly InspectorCrumb[]; label: string }) {
  const { t } = useTranslation();
  const { selected: path, open } = useContext(FieldNavContext);
  const steps = fieldsAlong(shape, values, path);
  const step = steps?.at(-1);
  const gone = !step;

  // The value is gone, such as with the changes discarded.
  useEffect(() => {
    if (gone) open([]);
  }, [gone, open]);

  if (!steps || !step) return null;

  const setAtPath = (target: ValuePath, value: unknown) => {
    const [key, ...rest] = target;

    if (typeof key === "string") onChange(key, setAt(values[key], rest, value));
  };
  const back = [
    ...crumbs,
    { label, onSelect: () => open([]) },
    ...steps
      .slice(0, -1)
      .flatMap((ancestor, index) =>
        opens(ancestor)
          ? [{ label: stepLabel(ancestor, t), onSelect: () => open(path.slice(0, index + 1)) }]
          : [],
      ),
  ];
  const actions = itemActions(step, steps.at(-2)?.value, path, setAtPath, open);
  const collection = collectionOf(step.field);
  // Fields keeping state of their own start over with another value.
  const key = path.join("/");

  if (!collection) {
    return (
      <InspectorView key={key} crumbs={back} title={stepLabel(step, t)} actions={actions}>
        <FieldRenderer
          schema={step.field}
          value={step.value}
          onChange={(value) => setAtPath(path, value)}
          path={path}
        />
      </InspectorView>
    );
  }

  const item = itemField(collection);
  const items = collectionItems(collection, step.value);
  const keys = contentKeys(items.map(([, value]) => value));
  const set = (next: readonly CollectionItem[]) => setAtPath(path, fromItems(collection, next));
  // New items open right away, the first of them, so it can be filled in.
  const append = (added: readonly CollectionItem[]) => {
    const [first] = added;

    if (!first) return;

    set([...items, ...added]);
    open([...path, first[0]]);
  };
  const paste = async () => {
    const text = await readClipboard();

    append((text !== undefined && pastedItems(collection, items, text)) || []);
  };

  return (
    <InspectorView
      key={key}
      crumbs={back}
      title={stepLabel(step, t)}
      description={collection.description}
      actions={actions}
    >
      <BlockList
        items={items}
        getKey={([itemKey]) =>
          typeof itemKey === "number" ? (keys[itemKey] ?? String(itemKey)) : itemKey
        }
        onMove={(from, to) => set(arrayMove(items, from, to))}
        row={([itemKey, value]) => ({
          label: itemLabel(collection, itemKey, value, t),
          summary: typeof itemKey === "string" ? valueSummary(item, value) : undefined,
          missing: missingValues(item, value),
          onOpen: () => open([...path, itemKey]),
          inspects: true,
        })}
      >
        <ListControls onPaste={() => void paste()}>
          {collection.type === "array" ? (
            <AddMenu
              options={addOptions(item)}
              onAdd={(option) =>
                append([
                  [
                    items.length,
                    getDefaultValue(item.type === "union" ? item.variants[Number(option)] : item),
                  ],
                ])
              }
            />
          ) : (
            <NewKeyInput
              onAdd={(name) => append([[freeKey(items, name), getDefaultValue(item)]])}
            />
          )}
        </ListControls>
      </BlockList>
    </InspectorView>
  );
}
