import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Asterisk,
  Braces,
  ChevronRight,
  File as FileIcon,
  Image as ImageIcon,
  Link as LinkIcon,
  Plus,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { isRequired, type FieldSchema } from "@/shared/field-schema";
import { activeVariant } from "@/shared/field-to-zod";
import { mediaRef, type MediaLocation } from "@/shared/media";
import config from "@/client/lib/config";
import { arrayMove } from "@/client/lib/arrays";
import { formatJson } from "@/client/lib/format-json";
import {
  asArray,
  asRecord,
  collectionItems,
  collectionOf,
  fieldLabel,
  getDefaultValue,
  itemField,
  missingValues,
  valueSummary,
  variantLabel,
  type CollectionField,
  type ValuePath,
} from "@/client/lib/field-values";
import { uniqueName } from "@/shared/paths";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { SortableList } from "@/client/components/sortable-list";
import { MissingProps } from "@/client/components/editors/block-controls";
import { useEntries } from "@/client/queries/use-entries";
import { useAssetUrl } from "@/client/queries/use-media";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { Switch } from "@/client/components/ui/switch";
import { Label } from "@/client/components/ui/label";
import { Button } from "@/client/components/ui/button";
import { collectionLabel } from "@/client/lib/collections";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/client/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

/** How a form opens one of its values in the inspector, and which one the inspector shows. */
export const FieldNavContext = createContext<{ selected: ValuePath; open: (path: ValuePath) => void }>({
  selected: [],
  open: () => {},
});

/** What every field is shown with: its label, whether it is required, and its description. */
interface FieldProps<V> {
  value: V;
  onChange: (value: unknown) => void;
  /** Left out for a field whose container already names it, such as an array item. */
  label?: string;
  required?: boolean;
  description?: string;
}

interface FieldRendererProps {
  schema: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  label?: string;
  required?: boolean;
  /** Where the value is in the values of its form, for the ones the inspector opens. */
  path?: ValuePath;
}

export function FieldRenderer({ schema, value, onChange, label, required, path = [] }: FieldRendererProps) {
  const common = { onChange, label, required, description: schema.description };

  if (schema.nullable) {
    const inner: FieldSchema = { ...schema, nullable: false };

    if (value === null || value === undefined) {
      return <NullableToggle {...common} value={null} onChange={() => onChange(getDefaultValue(inner))} />;
    }

    return (
      <NullableWrapper label={label} required={required} onClear={() => onChange(null)}>
        <FieldRenderer schema={inner} value={value} onChange={onChange} path={path} />
      </NullableWrapper>
    );
  }

  const resolved = value ?? schema.default;

  switch (schema.type) {
    case "image":
      return <ImageField {...common} value={asString(resolved)} repoOnly={schema.repoOnly} />;

    case "file":
      return <FileField {...common} value={asString(resolved)} />;

    case "reference":
      return <ReferenceField {...common} value={asString(resolved)} collection={schema.collection} />;

    case "string":
      if (schema.format === "email" || schema.format === "url") {
        return <StringField {...common} value={asString(resolved)} format={schema.format} />;
      }

      if (schema.maxLength && schema.maxLength > 200) {
        return <TextareaField {...common} value={asString(resolved)} />;
      }

      return <StringField {...common} value={asString(resolved)} />;

    case "number":
      return <NumberField {...common} value={asNumber(resolved)} integer={schema.integer} />;

    case "boolean":
      return <BooleanField {...common} value={asBoolean(resolved)} />;

    case "date":
      return <DateField {...common} value={asString(resolved)} />;

    case "enum":
      return <EnumField {...common} options={schema.options} value={value === null ? null : resolved} />;

    case "array":
    case "record": {
      const collection = collectionOf(schema);

      if (collection) return <CollectionRow {...common} schema={collection} value={resolved} path={path} />;

      return schema.type === "array" ? (
        <ArrayField {...common} element={schema.element} value={asArray(resolved)} />
      ) : (
        <RecordField {...common} valueSchema={schema.value} value={asRecord(resolved)} />
      );
    }

    case "tuple":
      return <TupleField {...common} items={schema.items} value={asArray(resolved)} path={path} />;

    case "object":
      return <ObjectField {...common} shape={schema.shape} value={asRecord(resolved)} path={path} />;

    case "union":
      // Only discriminated unions get the variant selector; a plain union has no
      // selector key, so it degrades to the raw editor.
      if (schema.discriminator === undefined) {
        return <FallbackField {...common} value={resolved} />;
      }

      return (
        <UnionField
          {...common}
          schema={schema}
          discriminator={schema.discriminator}
          value={asRecord(resolved)}
          path={path}
        />
      );

    default:
      return <FallbackField {...common} value={resolved} />;
  }
}

/**
 * The fields of an object, those without a `group` first and each group after
 * them as a section that opens on demand. Wide enough, the list is a table with
 * the labels in the first column.
 */
export function FieldList({
  shape,
  values,
  onChange,
  path = [],
}: {
  shape: Record<string, FieldSchema>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  path?: ValuePath;
}) {
  const groups = Map.groupBy(Object.entries(shape), ([, field]) => field.group ?? "");
  const render = ([key, field]: [string, FieldSchema]) => (
    <FieldRenderer
      key={key}
      schema={field}
      value={values[key]}
      // An optional field left empty is not written at all.
      onChange={(value) => onChange(key, value === "" && !isRequired(field) ? undefined : value)}
      label={fieldLabel(key, field)}
      required={isRequired(field)}
      path={[...path, key]}
    />
  );

  return (
    <div className="@container/fields space-y-4">
      {groups.get("")?.map(render)}
      {[...groups].flatMap(([group, fields]) =>
        group
          ? [
              <Collapsible key={group} className="rounded-md border border-border">
                <CollapsibleTrigger className="group flex w-full items-center gap-1 px-3 py-2 text-sm font-medium">
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                  {group}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{fields.length}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 border-t border-border p-3">
                  {fields.map(render)}
                </CollapsibleContent>
              </Collapsible>,
            ]
          : [],
      )}
    </div>
  );
}

function FieldShell({
  label,
  required,
  hint,
  description,
  children,
}: {
  label?: string;
  required?: boolean;
  /** What kind of value the field takes, where its input does not show it. */
  hint?: { icon: LucideIcon; text: string };
  description?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const content = (
    <div className="min-w-0 space-y-1.5">
      {children}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );

  // Unlabelled, the field is one its container already names, such as an item of a list.
  if (!label) return content;

  return (
    <div className="grid gap-1.5 @lg/fields:grid-cols-[9rem_minmax(0,1fr)] @lg/fields:gap-x-4">
      <Label className="flex-wrap @lg/fields:min-h-9">
        {label}
        {required && (
          <span className="-ml-1.5 text-destructive">
            <Asterisk className="size-3" />
            <span className="sr-only">{t(($) => $.editors.required)}</span>
          </span>
        )}
        {hint && (
          <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <hint.icon className="size-3" />
            {hint.text}
          </span>
        )}
      </Label>
      {content}
    </div>
  );
}

function StringField({
  value,
  onChange,
  format,
  ...shell
}: FieldProps<string> & { format?: "email" | "url" }) {
  return (
    <FieldShell {...shell}>
      <Input type={format ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} />
    </FieldShell>
  );
}

function TextareaField({ value, onChange, ...shell }: FieldProps<string>) {
  return (
    <FieldShell {...shell}>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} />
    </FieldShell>
  );
}

function NumberField({
  value,
  onChange,
  integer,
  ...shell
}: FieldProps<number | undefined> & { integer?: boolean }) {
  return (
    <FieldShell {...shell}>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : integer ? parseInt(v, 10) : parseFloat(v));
        }}
        step={integer ? 1 : "any"}
      />
    </FieldShell>
  );
}

function BooleanField({ value, onChange, ...shell }: FieldProps<boolean>) {
  return (
    <FieldShell {...shell}>
      <div className="flex min-h-9 items-center">
        <Switch checked={value} onCheckedChange={(checked) => onChange(checked)} />
      </div>
    </FieldShell>
  );
}

function DateField({ value, onChange, ...shell }: FieldProps<string>) {
  const date = new Date(value);
  // Shifted by the offset, since the input shows and returns local wall time.
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  const dateStr = value && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 16) : "";

  return (
    <FieldShell {...shell}>
      <Input
        type="datetime-local"
        value={dateStr}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")}
      />
    </FieldShell>
  );
}

function EnumField({
  options,
  value,
  onChange,
  ...shell
}: FieldProps<unknown> & { options: (string | number | boolean | null)[] }) {
  const selected = options.findIndex((option) => Object.is(option, value));

  return (
    <FieldShell {...shell}>
      <Select
        value={selected < 0 ? undefined : String(selected)}
        onValueChange={(index) => {
          const option = options[Number(index)];

          if (option !== undefined) onChange(option);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={<ChoosePlaceholder />} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option, index) => (
            <SelectItem key={index} value={String(index)}>
              {String(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

// A component of its own, so the fields that show it need no hooks themselves.
function ChoosePlaceholder() {
  const { t } = useTranslation();

  return t(($) => $.editors.choose);
}

function AssetField({
  value,
  onChange,
  assetType,
  repoOnly,
  children,
  ...shell
}: FieldProps<string> & {
  assetType: "image" | "file";
  repoOnly?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const kind = assetType === "image" ? t(($) => $.editors.image) : t(($) => $.editors.file);
  const [showPicker, setShowPicker] = useState(false);

  // The picker yields a library file; `mediaRef` spells it the way content
  // references that library: a root-absolute project path ("/src/assets/x.png"),
  // or the object store's public URL. Either resolves at render time, so a
  // picked file never needs a relative one.
  const handleSelect = (location: MediaLocation) => {
    onChange(mediaRef(location, config.media));
    setShowPicker(false);
  };

  return (
    <FieldShell {...shell} hint={{ icon: assetType === "image" ? ImageIcon : FileIcon, text: kind }}>
      <div className="flex gap-2">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={kind}
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={() => setShowPicker(true)}>
          {t(($) => $.editors.browse)}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange("")}>
            <X className="size-4" />
          </Button>
        )}
      </div>
      {children}
      <MediaPickerDialog
        open={showPicker}
        kind={assetType === "image" ? "image" : undefined}
        repoOnly={repoOnly}
        onSelect={handleSelect}
        onCancel={() => setShowPicker(false)}
      />
    </FieldShell>
  );
}

function ImageField(props: FieldProps<string> & { repoOnly?: boolean }) {
  const previewSrc = useAssetUrl(props.value);

  return (
    <AssetField {...props} assetType="image">
      {previewSrc && (
        <div className="h-24 w-24 overflow-hidden rounded border border-border">
          <img
            src={previewSrc}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
    </AssetField>
  );
}

function FileField(props: FieldProps<string>) {
  return <AssetField {...props} assetType="file" />;
}

function ReferenceField({
  value,
  onChange,
  collection,
  ...shell
}: FieldProps<string> & { collection: string }) {
  const { t } = useTranslation();
  const { data: entries, isLoading } = useEntries(collection);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!entries) return [];
    if (!query) return entries;
    const lower = query.toLowerCase();
    return entries.filter((e) => e.id.toLowerCase().includes(lower));
  }, [entries, query]);

  const handleSelect = (id: string) => {
    onChange(id);
    setQuery("");
    setIsOpen(false);
  };

  return (
    <FieldShell {...shell} hint={{ icon: LinkIcon, text: collectionLabel(collection) }}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type="text"
            value={isOpen ? query : value}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => {
              setQuery(value);
              setIsOpen(true);
            }}
            onBlur={() => {
              // Delay to allow click on dropdown item
              setTimeout(() => setIsOpen(false), 200);
            }}
            placeholder={
              isLoading
                ? t(($) => $.editors.loading)
                : t(($) => $.editors.selectFrom, { collection })
            }
          />
          {isOpen && filtered.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
              {filtered.map((entry) => (
                <li
                  key={entry.id}
                  onMouseDown={() => handleSelect(entry.id)}
                  className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-accent ${
                    entry.id === value
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-popover-foreground"
                  }`}
                >
                  {entry.id}
                </li>
              ))}
            </ul>
          )}
        </div>
        {value && !shell.required && (
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange("")}>
            <X className="size-4" />
          </Button>
        )}
      </div>
    </FieldShell>
  );
}

// A tuple is a fixed-length, heterogeneous list: each position has its own
// schema, so there is no add/remove, only per-slot editing.
function TupleField({
  items,
  value,
  onChange,
  path,
  ...shell
}: FieldProps<unknown[]> & { items: FieldSchema[]; path: ValuePath }) {
  const updateItem = (index: number, newValue: unknown) => {
    onChange(items.map((item, i) => (i === index ? newValue : (value[i] ?? getDefaultValue(item)))));
  };

  return (
    <FieldShell {...shell}>
      <div className="space-y-3 rounded-md border border-border p-3">
        {items.map((item, i) => (
          <FieldRenderer
            key={i}
            schema={item}
            value={value[i]}
            onChange={(v) => updateItem(i, v)}
            label={`${i + 1}`}
            path={[...path, i]}
          />
        ))}
      </div>
    </FieldShell>
  );
}

// Keys that follow array items through moves, so their local state stays with
// them. Items added or dropped elsewhere, such as by a reset, get fresh keys at
// the end.
function useItemKeys(length: number): [string[], (keys: string[]) => void] {
  const [keys, setKeys] = useState<string[]>(() => Array.from({ length }, () => crypto.randomUUID()));

  if (keys.length === length) return [keys, setKeys];

  const synced = [
    ...keys.slice(0, length),
    ...Array.from({ length: Math.max(0, length - keys.length) }, () => crypto.randomUUID()),
  ];

  setKeys(synced);

  return [synced, setKeys];
}

/** A list of single values, such as tags, edited in place. */
function ArrayField({ element, value, onChange, ...shell }: FieldProps<unknown[]> & { element: FieldSchema }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useItemKeys(value.length);

  const moveItem = (from: number, to: number) => {
    onChange(arrayMove(value, from, to));
    setKeys(arrayMove(keys, from, to));
  };

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setKeys(keys.filter((_, i) => i !== index));
  };

  return (
    <FieldShell {...shell}>
      <div className="space-y-2">
        <SortableList
          items={value}
          getKey={(_, index) => keys[index] ?? String(index)}
          onMove={moveItem}
          className="space-y-2"
        >
          {(item, index, handle) => (
            <div className="flex items-center gap-2">
              {handle}
              <div className="min-w-0 flex-1">
                <FieldRenderer
                  schema={element}
                  value={item}
                  onChange={(v) => onChange(value.map((current, i) => (i === index ? v : current)))}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t(($) => $.common.remove)}
                onClick={() => removeItem(index)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
        </SortableList>
        <Button type="button" variant="outline" size="xs" onClick={() => onChange([...value, getDefaultValue(element)])}>
          <Plus className="size-3" />
          {t(($) => $.editors.addItem)}
        </Button>
      </div>
    </FieldShell>
  );
}

/**
 * A list or record of structured items, as one row naming them. It opens them
 * in the inspector, where each is edited on its own.
 */
function CollectionRow({
  schema,
  value,
  path,
  ...shell
}: FieldProps<unknown> & { schema: CollectionField; path: ValuePath }) {
  const { t } = useTranslation();
  const { selected, open } = useContext(FieldNavContext);
  const items = collectionItems(schema, value);
  const item = itemField(schema);
  const isOpen = path.every((key, index) => selected[index] === key);
  const summary = items
    .map(([key, value]) => valueSummary(item, value) ?? (typeof key === "string" ? key : undefined))
    .filter(Boolean)
    .join(", ");
  const missing = new Set(items.flatMap(([, value]) => missingValues(item, value)));

  return (
    <FieldShell {...shell}>
      <Button
        type="button"
        variant="outline"
        aria-expanded={isOpen}
        className="w-full justify-start font-normal"
        onClick={() => open(path)}
      >
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t(($) => $.editors.items, { count: items.length })}
        </span>
        <MissingProps labels={[...missing]} />
        <ChevronRight className="text-muted-foreground" />
      </Button>
    </FieldShell>
  );
}

function ObjectField({
  shape,
  value,
  onChange,
  label,
  description,
  path,
}: FieldProps<Record<string, unknown>> & { shape: Record<string, FieldSchema>; path: ValuePath }) {
  const fields = (
    <FieldList shape={shape} values={value} onChange={(key, v) => onChange({ ...value, [key]: v })} path={path} />
  );

  // Unlabelled, the object is an item its container already frames.
  if (!label) return fields;

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{label}</legend>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {fields}
    </fieldset>
  );
}

/** Adds an item to a record under a key the editor types, a free one if it is taken. */
export function NewKeyInput({ onAdd }: { onAdd: (key: string) => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");

  const add = () => {
    if (!key.trim()) return;

    onAdd(key.trim());
    setKey("");
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder={t(($) => $.editors.newKey)}
        className="h-7 max-w-48"
      />
      <Button type="button" variant="outline" size="xs" onClick={add}>
        <Plus className="size-3" />
        {t(($) => $.editors.add)}
      </Button>
    </div>
  );
}

/** A record of single values, edited in place. */
function RecordField({
  valueSchema,
  value,
  onChange,
  ...shell
}: FieldProps<Record<string, unknown>> & { valueSchema: FieldSchema }) {
  const { t } = useTranslation();

  const removeField = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  return (
    <FieldShell {...shell}>
      <div className="space-y-3 rounded-md border border-border p-3">
        {Object.entries(value).map(([key, val]) => (
          <div key={key} className="flex items-start gap-2">
            <span className="mt-1.5 shrink-0 font-mono text-xs text-muted-foreground">{key}</span>
            <div className="min-w-0 flex-1">
              <FieldRenderer
                schema={valueSchema}
                value={val}
                onChange={(v) => onChange({ ...value, [key]: v })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t(($) => $.common.remove)}
              onClick={() => removeField(key)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <NewKeyInput
          onAdd={(key) =>
            onChange({ ...value, [uniqueName(key, (taken) => Object.hasOwn(value, taken))]: getDefaultValue(valueSchema) })
          }
        />
      </div>
    </FieldShell>
  );
}

function UnionField({
  schema,
  discriminator,
  value,
  onChange,
  path,
  ...shell
}: FieldProps<Record<string, unknown>> & {
  schema: Extract<FieldSchema, { type: "union" }>;
  discriminator: string;
  path: ValuePath;
}) {
  const { t } = useTranslation();
  const { variants } = schema;

  const selectedVariant = activeVariant(schema, value);
  const selectedIndex = selectedVariant ? variants.indexOf(selectedVariant) : -1;
  // The selector above already sets the discriminator.
  const shape = Object.fromEntries(
    Object.entries(selectedVariant?.type === "object" ? selectedVariant.shape : {}).filter(
      ([key]) => key !== discriminator,
    ),
  );

  return (
    <FieldShell {...shell}>
      <Select
        value={selectedIndex >= 0 ? String(selectedIndex) : undefined}
        onValueChange={(index) => {
          const variant = variants[Number(index)];
          if (variant) onChange(getDefaultValue(variant));
        }}
      >
        <SelectTrigger className="w-full" aria-label={t(($) => $.editors.variant)}>
          <SelectValue placeholder={<ChoosePlaceholder />} />
        </SelectTrigger>
        <SelectContent>
          {variants.map((_, i) => (
            <SelectItem key={i} value={String(i)}>
              {variantLabel(schema, i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {Object.keys(shape).length > 0 && (
        <div className="rounded-md border border-border p-3">
          <FieldList
            shape={shape}
            values={value}
            onChange={(key, v) => onChange({ ...value, [key]: v })}
            path={path}
          />
        </div>
      )}
    </FieldShell>
  );
}

function NullableToggle({ onChange, ...shell }: FieldProps<null>) {
  const { t } = useTranslation();

  return (
    <FieldShell {...shell}>
      <div>
        <Button type="button" variant="outline" size="xs" onClick={() => onChange(undefined)}>
          {t(($) => $.editors.setValue)}
        </Button>
      </div>
    </FieldShell>
  );
}

function NullableWrapper({
  label,
  required,
  onClear,
  children,
}: Pick<FieldProps<unknown>, "label" | "required"> & { onClear: () => void; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <FieldShell label={label} required={required}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t(($) => $.editors.clear)} onClick={onClear}>
          <X className="size-4" />
        </Button>
      </div>
    </FieldShell>
  );
}

function FallbackField({ value, onChange, ...shell }: FieldProps<unknown>) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => formatJson(value));

  return (
    <FieldShell {...shell} hint={{ icon: Braces, text: t(($) => $.editors.raw) }}>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            onChange(e.target.value);
          }
        }}
        rows={3}
        className="font-mono"
      />
    </FieldShell>
  );
}
