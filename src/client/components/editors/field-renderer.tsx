import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { isRequired, type FieldSchema } from "@/shared/field-schema";
import { activeVariant } from "@/shared/field-to-zod";
import { mediaRef, type MediaLocation } from "@/shared/media";
import config from "@/client/lib/config";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { useEntries } from "@/client/queries/use-entries";
import { useAssetUrl } from "@/client/queries/use-media";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { Switch } from "@/client/components/ui/switch";
import { Label } from "@/client/components/ui/label";
import { Button } from "@/client/components/ui/button";
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
function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
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

interface FieldRendererProps {
  schema: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  name: string;
  required?: boolean;
}

export function FieldRenderer({ schema, value, onChange, name, required }: FieldRendererProps) {
  if (schema.nullable) {
    const inner: FieldSchema = { ...schema, nullable: false };
    if (value === null || value === undefined) {
      return <NullableToggle name={name} onEnable={() => onChange(getDefaultValue(inner))} />;
    }
    return (
      <NullableWrapper name={name} onClear={() => onChange(null)}>
        <FieldRenderer
          schema={inner}
          value={value}
          onChange={onChange}
          name={name}
          required={required}
        />
      </NullableWrapper>
    );
  }

  const resolved = value ?? schema.default;

  switch (schema.type) {
    case "image":
      return (
        <ImageField
          name={name}
          value={asString(resolved)}
          onChange={onChange}
          required={required}
          repoOnly={schema.repoOnly}
        />
      );

    case "file":
      return (
        <FileField name={name} value={asString(resolved)} onChange={onChange} required={required} />
      );

    case "reference":
      return (
        <ReferenceField
          name={name}
          value={asString(resolved)}
          onChange={onChange}
          required={required}
          collection={schema.collection}
        />
      );

    case "string":
      if (schema.format === "email" || schema.format === "url") {
        return (
          <StringField
            name={name}
            value={asString(resolved)}
            onChange={onChange}
            required={required}
            format={schema.format}
          />
        );
      }
      if (schema.maxLength && schema.maxLength > 200) {
        return (
          <TextareaField
            name={name}
            value={asString(resolved)}
            onChange={onChange}
            required={required}
          />
        );
      }
      return (
        <StringField
          name={name}
          value={asString(resolved)}
          onChange={onChange}
          required={required}
        />
      );

    case "number":
      return (
        <NumberField
          name={name}
          value={asNumber(resolved)}
          onChange={onChange}
          required={required}
          integer={schema.integer}
        />
      );

    case "boolean":
      return <BooleanField name={name} value={asBoolean(resolved)} onChange={onChange} />;

    case "date":
      return (
        <DateField name={name} value={asString(resolved)} onChange={onChange} required={required} />
      );

    case "enum":
      return (
        <EnumField
          options={schema.options}
          name={name}
          value={value === null ? null : resolved}
          onChange={onChange}
          required={required}
        />
      );

    case "array":
      return (
        <ArrayField
          element={schema.element}
          name={name}
          value={asArray(resolved)}
          onChange={onChange}
        />
      );

    case "tuple":
      return (
        <TupleField
          items={schema.items}
          name={name}
          value={asArray(resolved)}
          onChange={onChange}
        />
      );

    case "object":
      return (
        <ObjectField
          shape={schema.shape}
          name={name}
          value={asRecord(resolved)}
          onChange={onChange}
        />
      );

    case "record":
      return (
        <RecordField
          valueSchema={schema.value}
          name={name}
          value={asRecord(resolved)}
          onChange={onChange}
        />
      );

    case "union":
      // Only discriminated unions get the variant selector; a plain union has no
      // selector key, so it degrades to the raw editor.
      if (schema.discriminator === undefined) {
        return <FallbackField name={name} value={resolved} onChange={onChange} />;
      }

      return (
        <UnionField
          schema={schema}
          discriminator={schema.discriminator}
          name={name}
          value={asRecord(resolved)}
          onChange={onChange}
        />
      );

    default:
      return <FallbackField name={name} value={resolved} onChange={onChange} />;
  }
}

function StringField({
  name,
  value,
  onChange,
  required,
  format,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
  format?: "email" | "url";
}) {
  const type = format === "url" ? "url" : format === "email" ? "email" : "text";
  return (
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TextareaField({
  name,
  value,
  onChange,
  required,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  return (
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={4} />
    </div>
  );
}

function NumberField({
  name,
  value,
  onChange,
  required,
  integer,
}: {
  name: string;
  value: number;
  onChange: (v: unknown) => void;
  required?: boolean;
  integer?: boolean;
}) {
  return (
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : integer ? parseInt(v, 10) : parseFloat(v));
        }}
        step={integer ? 1 : "any"}
      />
    </div>
  );
}

function BooleanField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: boolean;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={!!value} onCheckedChange={(checked) => onChange(checked)} />
      <Label>{name}</Label>
    </div>
  );
}

function DateField({
  name,
  value,
  onChange,
  required,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  const date = new Date(value);
  // Shifted by the offset, since the input shows and returns local wall time.
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  const dateStr = value && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 16) : "";

  return (
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        type="datetime-local"
        value={dateStr}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")}
      />
    </div>
  );
}

function EnumField({
  options,
  name,
  value,
  onChange,
  required,
}: {
  options: (string | number | boolean | null)[];
  name: string;
  value: unknown;
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  const selected = options.findIndex((option) => Object.is(option, value));

  return (
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Select
        value={selected < 0 ? undefined : String(selected)}
        onValueChange={(index) => {
          const option = options[Number(index)];

          if (option !== undefined) onChange(option);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="--" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option, index) => (
            <SelectItem key={index} value={String(index)}>
              {String(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AssetField({
  name,
  value,
  onChange,
  required,
  assetType,
  repoOnly,
  children,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
  assetType: "image" | "file";
  repoOnly?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const label = assetType === "image" ? t(($) => $.editors.image) : t(($) => $.editors.file);
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
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
        <span className="ml-1 text-xs text-muted-foreground">({label})</span>
      </Label>
      <div className="flex gap-2">
        <Input
          type="text"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
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
    </div>
  );
}

function ImageField({
  name,
  value,
  onChange,
  required,
  repoOnly,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
  /** Astro's plain collection `image()`, which only a repository file satisfies. */
  repoOnly?: boolean;
}) {
  const previewSrc = useAssetUrl(value);

  return (
    <AssetField
      name={name}
      value={value}
      onChange={onChange}
      required={required}
      assetType="image"
      repoOnly={repoOnly}
    >
      {previewSrc && (
        <div className="mt-2 h-24 w-24 overflow-hidden rounded border border-border">
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

function FileField({
  name,
  value,
  onChange,
  required,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  return (
    <AssetField
      name={name}
      value={value}
      onChange={onChange}
      required={required}
      assetType="file"
    />
  );
}

function ReferenceField({
  name,
  value,
  onChange,
  required,
  collection,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
  collection: string;
}) {
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
    <div className="relative">
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
        <span className="ml-1 text-xs text-muted-foreground">
          ({t(($) => $.editors.ref, { collection })})
        </span>
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type="text"
            value={isOpen ? query : (value ?? "")}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => {
              setQuery(value ?? "");
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
        {value && !required && (
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange("")}>
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function isComplexSchema(schema?: FieldSchema): boolean {
  return schema?.type === "object" || schema?.type === "array" || schema?.type === "record";
}

// A tuple is a fixed-length, heterogeneous list: each position has its own
// schema, so there is no add/remove, only per-slot editing.
function TupleField({
  items,
  name,
  value,
  onChange,
}: {
  items: FieldSchema[];
  name: string;
  value: unknown[];
  onChange: (v: unknown) => void;
}) {
  const current = Array.isArray(value) ? value : [];

  const updateItem = (index: number, newValue: unknown) => {
    const updated = items.map((item, i) =>
      i === index ? newValue : (current[i] ?? getDefaultValue(item)),
    );
    onChange(updated);
  };

  return (
    <div>
      <Label>{name}</Label>
      <div className="space-y-2 rounded-md border border-border p-3">
        {items.map((item, i) => (
          <FieldRenderer
            key={i}
            schema={item}
            value={current[i]}
            onChange={(v) => updateItem(i, v)}
            name={`${i}`}
          />
        ))}
      </div>
    </div>
  );
}

function ArrayField({
  element,
  name,
  value,
  onChange,
}: {
  element: FieldSchema;
  name: string;
  value: unknown[];
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const items = Array.isArray(value) ? value : [];
  const needsConfirm = isComplexSchema(element);
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);

  const updateItem = (index: number, newValue: unknown) => {
    const updated = [...items];
    updated[index] = newValue;
    onChange(updated);
  };

  const addItem = () => {
    onChange([...items, getDefaultValue(element)]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div>
      <Label>{name}</Label>
      <div className="space-y-2 rounded-md border border-border p-3">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <FieldRenderer
                schema={element}
                value={item}
                onChange={(v) => updateItem(i, v)}
                name={`${i}`}
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              className="mt-6"
              onClick={() => (needsConfirm ? setConfirmRemoveIndex(i) : removeItem(i))}
            >
              {t(($) => $.common.remove)}
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="xs" onClick={addItem}>
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
    </div>
  );
}

function ObjectField({
  shape,
  name,
  value,
  onChange,
}: {
  shape: Record<string, FieldSchema>;
  name: string;
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const updateField = (key: string, newValue: unknown) => {
    onChange({ ...value, [key]: newValue });
  };

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{name}</legend>
      <div className="space-y-3">
        {Object.entries(shape).map(([key, fieldSchema]) => (
          <FieldRenderer
            key={key}
            schema={fieldSchema}
            value={value[key]}
            onChange={(v) => updateField(key, v)}
            name={key}
            required={isRequired(fieldSchema)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function RecordField({
  valueSchema,
  name,
  value,
  onChange,
}: {
  valueSchema: FieldSchema;
  name: string;
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const needsConfirm = isComplexSchema(valueSchema);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  const updateField = (key: string, newValue: unknown) => {
    onChange({ ...value, [key]: newValue });
  };

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
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{name}</legend>
      <div className="space-y-3">
        {Object.entries(value).map(([key, val]) => (
          <div key={key} className="flex items-start gap-2">
            <span className="mt-1.5 shrink-0 text-xs font-mono text-muted-foreground">{key}</span>
            <div className="flex-1">
              <FieldRenderer
                schema={valueSchema}
                value={val}
                onChange={(v) => updateField(key, v)}
                name={key}
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              className="mt-1"
              onClick={() => (needsConfirm ? setConfirmRemoveKey(key) : removeField(key))}
            >
              {t(($) => $.common.remove)}
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
    </fieldset>
  );
}

function UnionField({
  schema,
  discriminator,
  name,
  value,
  onChange,
}: {
  schema: Extract<FieldSchema, { type: "union" }>;
  discriminator: string;
  name: string;
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const { variants } = schema;

  const variantLabel = (variant: FieldSchema, index: number): string => {
    const disc = variant.type === "object" ? variant.shape[discriminator] : undefined;
    return disc?.type === "literal" ? String(disc.value) : String(index);
  };

  const selectedVariant = activeVariant(schema, value);
  const selectedIndex = selectedVariant ? variants.indexOf(selectedVariant) : -1;

  const handleVariantChange = (index: number) => {
    const variant = variants[index];
    if (variant) onChange(getDefaultValue(variant));
  };

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{name}</legend>
      <div className="space-y-3">
        <div>
          <Label>{t(($) => $.editors.variant)}</Label>
          <Select
            value={selectedIndex >= 0 ? String(selectedIndex) : undefined}
            onValueChange={(val) => handleVariantChange(Number(val))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="--" />
            </SelectTrigger>
            <SelectContent>
              {variants.map((variant, i) => (
                <SelectItem key={i} value={String(i)}>
                  {variantLabel(variant, i)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedVariant?.type === "object" && (
          <ObjectField shape={selectedVariant.shape} name="" value={value} onChange={onChange} />
        )}
      </div>
    </fieldset>
  );
}

function NullableToggle({ name, onEnable }: { name: string; onEnable: () => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <Label>{name}</Label>
      <Button type="button" variant="outline" size="xs" onClick={onEnable}>
        {t(($) => $.editors.setValue)}
      </Button>
    </div>
  );
}

function NullableWrapper({
  name,
  onClear,
  children,
}: {
  name: string;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{name}</span>
        <Button type="button" variant="ghost" size="xs" onClick={onClear}>
          {t(($) => $.editors.clear)}
        </Button>
      </div>
      {children}
    </div>
  );
}

function FallbackField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() =>
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? ""),
  );

  return (
    <div>
      <Label>
        {name} <span className="text-xs text-muted-foreground">{t(($) => $.editors.raw)}</span>
      </Label>
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
    </div>
  );
}

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
        if (!fieldSchema.optional) {
          obj[key] = getDefaultValue(fieldSchema);
        }
      }
      return obj;
    }
    case "union":
      return schema.variants[0] ? getDefaultValue(schema.variants[0]) : {};
    default:
      return "";
  }
}
