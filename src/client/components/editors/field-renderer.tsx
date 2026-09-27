import { useState, useMemo, type ReactNode } from "react";
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
import { fieldLabel, getDefaultValue, textSummary } from "@/client/lib/field-values";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { SortableList } from "@/client/components/sortable-list";
import { useEntries } from "@/client/queries/use-entries";
import { useAssetUrl } from "@/client/queries/use-media";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { Switch } from "@/client/components/ui/switch";
import { Label } from "@/client/components/ui/label";
import { Button } from "@/client/components/ui/button";
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
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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
}

export function FieldRenderer({ schema, value, onChange, label, required }: FieldRendererProps) {
  const common = { onChange, label, required, description: schema.description };

  if (schema.nullable) {
    const inner: FieldSchema = { ...schema, nullable: false };

    if (value === null || value === undefined) {
      return <NullableToggle {...common} value={null} onChange={() => onChange(getDefaultValue(inner))} />;
    }

    return (
      <NullableWrapper label={label} onClear={() => onChange(null)}>
        <FieldRenderer schema={inner} value={value} onChange={onChange} />
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
      return <ArrayField {...common} element={schema.element} value={asArray(resolved)} />;

    case "tuple":
      return <TupleField {...common} items={schema.items} value={asArray(resolved)} />;

    case "object":
      return <ObjectField {...common} shape={schema.shape} value={asRecord(resolved)} />;

    case "record":
      return <RecordField {...common} valueSchema={schema.value} value={asRecord(resolved)} />;

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
        />
      );

    default:
      return <FallbackField {...common} value={resolved} />;
  }
}

/**
 * The fields of an object, those without a `group` first and each group after
 * them as a section that opens on demand.
 */
export function FieldList({
  shape,
  values,
  onChange,
}: {
  shape: Record<string, FieldSchema>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const groups = Map.groupBy(Object.entries(shape), ([, field]) => field.group ?? "");
  const render = ([key, field]: [string, FieldSchema]) => (
    <FieldRenderer
      key={key}
      schema={field}
      value={values[key]}
      onChange={(value) => onChange(key, value)}
      label={fieldLabel(key, field)}
      required={isRequired(field)}
    />
  );

  return (
    <div className="space-y-4">
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

  return (
    <div className="space-y-1.5">
      {label && (
        <Label>
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
      )}
      {children}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
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

function BooleanField({ value, onChange, label, description }: FieldProps<boolean>) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch checked={value} onCheckedChange={(checked) => onChange(checked)} />
        {label && <Label>{label}</Label>}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
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
    <FieldShell {...shell} hint={{ icon: LinkIcon, text: collection }}>
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

function isComplexSchema(schema?: FieldSchema): boolean {
  return (
    schema?.type === "object" ||
    schema?.type === "array" ||
    schema?.type === "record" ||
    schema?.type === "tuple" ||
    schema?.type === "union"
  );
}

// A tuple is a fixed-length, heterogeneous list: each position has its own
// schema, so there is no add/remove, only per-slot editing.
function TupleField({ items, value, onChange, ...shell }: FieldProps<unknown[]> & { items: FieldSchema[] }) {
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
          />
        ))}
      </div>
    </FieldShell>
  );
}

// Keys that follow array items through moves, so their local state and open
// sections stay with them. Items added or dropped elsewhere, such as by a
// reset, get fresh keys at the end.
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

// The text that names a structured item in its collapsed header.
function itemSummary(schema: FieldSchema, value: unknown): string | undefined {
  if (schema.type === "object") return textSummary(schema.shape, asRecord(value));

  if (schema.type === "union") {
    const variant = activeVariant(schema, value);

    return variant?.type === "object" ? textSummary(variant.shape, asRecord(value)) : undefined;
  }

  return undefined;
}

function ArrayField({ element, value, onChange, ...shell }: FieldProps<unknown[]> & { element: FieldSchema }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useItemKeys(value.length);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);
  const complex = isComplexSchema(element);

  const updateItem = (index: number, newValue: unknown) => {
    onChange(value.map((item, i) => (i === index ? newValue : item)));
  };

  const moveItem = (from: number, to: number) => {
    onChange(arrayMove(value, from, to));
    setKeys(arrayMove(keys, from, to));
  };

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setKeys(keys.filter((_, i) => i !== index));
  };

  const addItem = () => {
    const key = crypto.randomUUID();

    onChange([...value, getDefaultValue(element)]);
    setKeys([...keys, key]);
    setOpen(new Set(open).add(key));
  };

  const toggle = (key: string, isOpen: boolean) => {
    const next = new Set(open);

    if (isOpen) next.add(key);
    else next.delete(key);

    setOpen(next);
  };

  const removeButton = (index: number) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={t(($) => $.common.remove)}
      onClick={() => (complex ? setConfirmRemoveIndex(index) : removeItem(index))}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );

  return (
    <FieldShell {...shell}>
      <div className="space-y-2">
        <SortableList
          items={value}
          getKey={(_, index) => keys[index] ?? String(index)}
          onMove={moveItem}
          className="space-y-2"
        >
          {(item, index, handle) => {
            const key = keys[index] ?? String(index);
            const field = (
              <FieldRenderer schema={element} value={item} onChange={(v) => updateItem(index, v)} />
            );

            if (!complex) {
              return (
                <div className="flex items-center gap-2">
                  {handle}
                  <div className="min-w-0 flex-1">{field}</div>
                  {removeButton(index)}
                </div>
              );
            }

            return (
              <Collapsible
                open={open.has(key)}
                onOpenChange={(isOpen) => toggle(key, isOpen)}
                className="rounded-md border border-border"
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  {handle}
                  <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1 text-left text-sm">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                    <span className="truncate">
                      {itemSummary(element, item) ?? t(($) => $.editors.item, { index: String(index + 1) })}
                    </span>
                  </CollapsibleTrigger>
                  {removeButton(index)}
                </div>
                <CollapsibleContent className="border-t border-border p-3">{field}</CollapsibleContent>
              </Collapsible>
            );
          }}
        </SortableList>
        <Button type="button" variant="outline" size="xs" onClick={addItem}>
          <Plus className="size-3" />
          {t(($) => $.editors.addItem)}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRemoveIndex !== null}
        title={t(($) => $.editors.removeItem)}
        message={t(($) => $.editors.removeItemMessage, {
          index: confirmRemoveIndex !== null ? String(confirmRemoveIndex + 1) : "",
        })}
        confirmLabel={t(($) => $.common.remove)}
        variant="danger"
        onConfirm={() => {
          if (confirmRemoveIndex !== null) removeItem(confirmRemoveIndex);
          setConfirmRemoveIndex(null);
        }}
        onCancel={() => setConfirmRemoveIndex(null)}
      />
    </FieldShell>
  );
}

function ObjectField({
  shape,
  value,
  onChange,
  label,
  description,
}: FieldProps<Record<string, unknown>> & { shape: Record<string, FieldSchema> }) {
  const fields = (
    <FieldList shape={shape} values={value} onChange={(key, v) => onChange({ ...value, [key]: v })} />
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

function RecordField({
  valueSchema,
  value,
  onChange,
  ...shell
}: FieldProps<Record<string, unknown>> & { valueSchema: FieldSchema }) {
  const { t } = useTranslation();
  const needsConfirm = isComplexSchema(valueSchema);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  const removeField = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const addField = () => {
    if (!newKey.trim()) return;
    onChange({ ...value, [newKey.trim()]: getDefaultValue(valueSchema) });
    setNewKey("");
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
              onClick={() => (needsConfirm ? setConfirmRemoveKey(key) : removeField(key))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addField()}
            placeholder={t(($) => $.editors.newKey)}
            className="max-w-48"
          />
          <Button type="button" variant="outline" size="xs" onClick={addField}>
            <Plus className="size-3" />
            {t(($) => $.editors.add)}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemoveKey !== null}
        title={t(($) => $.editors.removeField)}
        message={t(($) => $.editors.removeFieldMessage, { key: confirmRemoveKey ?? "" })}
        confirmLabel={t(($) => $.common.remove)}
        variant="danger"
        onConfirm={() => {
          if (confirmRemoveKey !== null) removeField(confirmRemoveKey);
          setConfirmRemoveKey(null);
        }}
        onCancel={() => setConfirmRemoveKey(null)}
      />
    </FieldShell>
  );
}

function UnionField({
  schema,
  discriminator,
  value,
  onChange,
  ...shell
}: FieldProps<Record<string, unknown>> & {
  schema: Extract<FieldSchema, { type: "union" }>;
  discriminator: string;
}) {
  const { t } = useTranslation();
  const { variants } = schema;

  const variantLabel = (variant: FieldSchema, index: number): string => {
    const disc = variant.type === "object" ? variant.shape[discriminator] : undefined;
    return disc?.type === "literal" ? String(disc.value) : String(index);
  };

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
          {variants.map((variant, i) => (
            <SelectItem key={i} value={String(i)}>
              {variantLabel(variant, i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {Object.keys(shape).length > 0 && (
        <div className="rounded-md border border-border p-3">
          <FieldList shape={shape} values={value} onChange={(key, v) => onChange({ ...value, [key]: v })} />
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
  onClear,
  children,
}: {
  label?: string;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Button type="button" variant="ghost" size="xs" onClick={onClear}>
          {t(($) => $.editors.clear)}
        </Button>
      </div>
      {children}
    </div>
  );
}

function FallbackField({ value, onChange, ...shell }: FieldProps<unknown>) {
  const { t } = useTranslation();
  const [text, setText] = useState(() =>
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? ""),
  );

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
