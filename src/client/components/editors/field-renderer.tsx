import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { getAssetType, getReferenceCollection } from "@shared/schema-utils";
import { useEntryContext } from "@client/lib/entry-context";
import { toRelativeAssetPath, resolveAssetPath, toPreviewUrl } from "@client/lib/asset-utils";
import { MediaPickerDialog } from "@client/components/media-picker-dialog";
import { ConfirmDialog } from "@client/components/confirm-dialog";
import { useEntries } from "@client/queries/use-entries";
import { Input } from "@client/components/ui/input";
import { Textarea } from "@client/components/ui/textarea";
import { Switch } from "@client/components/ui/switch";
import { Label } from "@client/components/ui/label";
import { Button } from "@client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@client/components/ui/select";

/**
 * Runtime interface for Zod schemas as provided by astro/zod.
 * Astro ships Zod v4 at runtime; this captures the API surface
 * used by the field renderer for direct schema introspection.
 */
export interface ZodFieldSchema {
  def: {
    type: string;
    value?: unknown;
    defaultValue?: unknown;
    discriminator?: string;
    options?: ZodFieldSchema[];
    out?: ZodFieldSchema;
  };
  unwrap?(): ZodFieldSchema;
  shape?: Record<string, ZodFieldSchema>;
  element?: ZodFieldSchema;
  options?: unknown[];
  meta?(): Record<string, unknown> | undefined;
  keyType?: ZodFieldSchema;
  valueType?: ZodFieldSchema;
  maxLength?: number;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}
function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
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
  schema: ZodFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  name: string;
  required?: boolean;
}

export function FieldRenderer({ schema, value, onChange, name, required }: FieldRendererProps) {
  const type = schema.def.type;

  // Unwrap wrappers
  if (type === "optional" && schema.unwrap) {
    return (
      <FieldRenderer
        schema={schema.unwrap()}
        value={value}
        onChange={onChange}
        name={name}
        required={false}
      />
    );
  }
  if (type === "nullable" && schema.unwrap) {
    const inner = schema.unwrap();
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
  if (type === "default" && schema.unwrap) {
    return (
      <FieldRenderer
        schema={schema.unwrap()}
        value={value ?? schema.def.defaultValue}
        onChange={onChange}
        name={name}
        required={required}
      />
    );
  }
  if (type === "pipe" && schema.def.out) {
    return (
      <FieldRenderer
        schema={schema.def.out}
        value={value}
        onChange={onChange}
        name={name}
        required={required}
      />
    );
  }

  // Check metadata for asset fields (image/file)
  const assetType = getAssetType(schema);
  if (assetType === "image") {
    return (
      <ImageField name={name} value={asString(value)} onChange={onChange} required={required} />
    );
  }
  if (assetType === "file") {
    return (
      <FileField name={name} value={asString(value)} onChange={onChange} required={required} />
    );
  }

  const refCollection = getReferenceCollection(schema);
  if (refCollection) {
    return (
      <ReferenceField
        name={name}
        value={asString(value)}
        onChange={onChange}
        required={required}
        collection={refCollection}
      />
    );
  }

  switch (type) {
    case "string":
      if (schema.maxLength && schema.maxLength > 200) {
        return (
          <TextareaField
            name={name}
            value={asString(value)}
            onChange={onChange}
            required={required}
          />
        );
      }
      return (
        <StringField name={name} value={asString(value)} onChange={onChange} required={required} />
      );

    case "email":
      return (
        <StringField
          name={name}
          value={asString(value)}
          onChange={onChange}
          required={required}
          format="email"
        />
      );

    case "url":
      return (
        <StringField
          name={name}
          value={asString(value)}
          onChange={onChange}
          required={required}
          format="url"
        />
      );

    case "number":
      return (
        <NumberField name={name} value={asNumber(value)} onChange={onChange} required={required} />
      );

    case "int":
      return (
        <NumberField
          name={name}
          value={asNumber(value)}
          onChange={onChange}
          required={required}
          integer
        />
      );

    case "boolean":
      return <BooleanField name={name} value={asBoolean(value)} onChange={onChange} />;

    case "date":
      return (
        <DateField name={name} value={asString(value)} onChange={onChange} required={required} />
      );

    case "enum":
      return (
        <EnumField
          schema={schema}
          name={name}
          value={asString(value)}
          onChange={onChange}
          required={required}
        />
      );

    case "array":
      return <ArrayField schema={schema} name={name} value={asArray(value)} onChange={onChange} />;

    case "object":
      return (
        <ObjectField schema={schema} name={name} value={asRecord(value)} onChange={onChange} />
      );

    case "record":
      return (
        <RecordField schema={schema} name={name} value={asRecord(value)} onChange={onChange} />
      );

    case "union":
      if (schema.def.discriminator) {
        return (
          <UnionField
            schema={schema}
            name={name}
            value={asRecord(value)}
            onChange={onChange}
            discriminator={schema.def.discriminator}
          />
        );
      }
      return <FallbackField name={name} value={value} onChange={onChange} />;

    default:
      return <FallbackField name={name} value={value} onChange={onChange} />;
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
  format?: string;
}) {
  const type = format === "uri" || format === "url" ? "url" : format === "email" ? "email" : "text";
  return (
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
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
      <Textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
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
  const dateStr = value ? new Date(value).toISOString().slice(0, 16) : "";

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
  schema,
  name,
  value,
  onChange,
  required,
}: {
  schema: ZodFieldSchema;
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  const options = (schema.options ?? []).map(String);
  return (
    <div>
      <Label>
        {name}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Select value={value || undefined} onValueChange={(val) => onChange(val)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="--" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={String(opt)} value={String(opt)}>
              {String(opt)}
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
  children,
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
  assetType: "image" | "file";
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const label = assetType === "image" ? t($ => $.editors.image) : t($ => $.editors.file);
  const [showPicker, setShowPicker] = useState(false);
  const ctx = useEntryContext();

  const handleSelect = (assetPath: string) => {
    const relativePath = ctx ? toRelativeAssetPath(ctx.contentFilePath, assetPath) : assetPath;
    onChange(relativePath);
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
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowPicker(true)}
        >
          {t($ => $.editors.browse)}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onChange("")}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {children}
      <MediaPickerDialog
        open={showPicker}
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
}: {
  name: string;
  value: string;
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  const ctx = useEntryContext();
  const previewSrc =
    value && ctx ? toPreviewUrl(resolveAssetPath(ctx.contentFilePath, value)) : undefined;

  return (
    <AssetField name={name} value={value} onChange={onChange} required={required} assetType="image">
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
    <AssetField name={name} value={value} onChange={onChange} required={required} assetType="file" />
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
        <span className="ml-1 text-xs text-muted-foreground">({t($ => $.editors.ref, { collection })})</span>
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type="text"
            value={isOpen ? query : value ?? ""}
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
            placeholder={isLoading ? t($ => $.editors.loading) : t($ => $.editors.selectFrom, { collection })}
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
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onChange("")}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function isComplexSchema(schema?: ZodFieldSchema): boolean {
  if (!schema) return false;
  const type = schema.def.type;
  if (type === "object" || type === "array" || type === "record") return true;
  if ((type === "optional" || type === "nullable" || type === "default") && schema.unwrap) {
    return isComplexSchema(schema.unwrap());
  }
  return false;
}

function ArrayField({
  schema,
  name,
  value,
  onChange,
}: {
  schema: ZodFieldSchema;
  name: string;
  value: unknown[];
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const items = Array.isArray(value) ? value : [];
  const itemSchema = schema.element;
  const needsConfirm = isComplexSchema(itemSchema);
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);

  const updateItem = (index: number, newValue: unknown) => {
    const updated = [...items];
    updated[index] = newValue;
    onChange(updated);
  };

  const addItem = () => {
    onChange([...items, getDefaultValue(itemSchema)]);
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
              {itemSchema ? (
                <FieldRenderer
                  schema={itemSchema}
                  value={item}
                  onChange={(v) => updateItem(i, v)}
                  name={`${i}`}
                />
              ) : (
                <FallbackField name={`${i}`} value={item} onChange={(v) => updateItem(i, v)} />
              )}
            </div>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              className="mt-6"
              onClick={() => (needsConfirm ? setConfirmRemoveIndex(i) : removeItem(i))}
            >
              {t($ => $.common.remove)}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={addItem}
        >
          {t($ => $.editors.addItem)}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRemoveIndex !== null}
        title={t($ => $.editors.removeItem)}
        message={t($ => $.editors.removeItemMessage, { index: confirmRemoveIndex !== null ? String(confirmRemoveIndex + 1) : "" })}
        confirmLabel={t($ => $.common.remove)}
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
  schema,
  name,
  value,
  onChange,
}: {
  schema: ZodFieldSchema;
  name: string;
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const obj = typeof value === "object" && value !== null ? value : {};
  const shape = schema.shape ?? {};

  const updateField = (key: string, newValue: unknown) => {
    onChange({ ...obj, [key]: newValue });
  };

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{name}</legend>
      <div className="space-y-3">
        {Object.entries(shape).map(([key, fieldSchema]) => (
          <FieldRenderer
            key={key}
            schema={fieldSchema}
            value={obj[key]}
            onChange={(v) => updateField(key, v)}
            name={key}
            required={fieldSchema.def.type !== "optional"}
          />
        ))}
      </div>
    </fieldset>
  );
}

function RecordField({
  schema,
  name,
  value,
  onChange,
}: {
  schema: ZodFieldSchema;
  name: string;
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const obj = asRecord(value);
  const valueSchema = schema.valueType;
  const needsConfirm = isComplexSchema(valueSchema);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  const updateField = (key: string, newValue: unknown) => {
    onChange({ ...obj, [key]: newValue });
  };

  const removeField = (key: string) => {
    const next = { ...obj };
    delete next[key];
    onChange(next);
  };

  const addField = () => {
    if (!newKey.trim()) return;
    onChange({ ...obj, [newKey.trim()]: getDefaultValue(valueSchema) });
    setNewKey("");
  };

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{name}</legend>
      <div className="space-y-3">
        {Object.entries(obj).map(([key, val]) => (
          <div key={key} className="flex items-start gap-2">
            <span className="mt-1.5 shrink-0 text-xs font-mono text-muted-foreground">{key}</span>
            <div className="flex-1">
              {valueSchema ? (
                <FieldRenderer
                  schema={valueSchema}
                  value={val}
                  onChange={(v) => updateField(key, v)}
                  name={key}
                />
              ) : (
                <FallbackField name={key} value={val} onChange={(v) => updateField(key, v)} />
              )}
            </div>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              className="mt-1"
              onClick={() => (needsConfirm ? setConfirmRemoveKey(key) : removeField(key))}
            >
              {t($ => $.common.remove)}
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addField()}
            placeholder={t($ => $.editors.newKey)}
            className="max-w-48"
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={addField}
          >
            {t($ => $.editors.add)}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemoveKey !== null}
        title={t($ => $.editors.removeField)}
        message={t($ => $.editors.removeFieldMessage, { key: confirmRemoveKey ?? "" })}
        confirmLabel={t($ => $.common.remove)}
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
  name,
  value,
  onChange,
  discriminator,
}: {
  schema: ZodFieldSchema;
  name: string;
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
  discriminator: string;
}) {
  const { t } = useTranslation();
  const variants = schema.def.options ?? [];
  const currentDiscValue = value[discriminator];

  const selectedIndex = variants.findIndex((v) => {
    const shape = v.shape;
    if (!shape?.[discriminator]) return false;
    // Check if the discriminator field is a literal matching the current value
    const discSchema = shape[discriminator];
    if (discSchema.def.type === "literal") {
      return discSchema.def.value === currentDiscValue;
    }
    return false;
  });

  const handleVariantChange = (index: number) => {
    const variant = variants[index];
    if (variant) {
      onChange(getDefaultValue(variant));
    }
  };

  const selectedVariant = selectedIndex >= 0 ? variants[selectedIndex] : undefined;

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{name}</legend>
      <div className="space-y-3">
        <div>
          <Label>{t($ => $.editors.variant)}</Label>
          <Select
            value={selectedIndex >= 0 ? String(selectedIndex) : undefined}
            onValueChange={(val) => handleVariantChange(Number(val))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="--" />
            </SelectTrigger>
            <SelectContent>
              {variants.map((v, i) => {
                const discField = v.shape?.[discriminator];
                const label =
                  discField?.def.type === "literal" && discField.def.value != null
                    ? `${discField.def.value as string | number}`
                    : String(i);
                return (
                  <SelectItem key={i} value={String(i)}>
                    {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        {selectedVariant && (
          <ObjectField schema={selectedVariant} name="" value={value ?? {}} onChange={onChange} />
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
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={onEnable}
      >
        {t($ => $.editors.setValue)}
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
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onClear}
        >
          {t($ => $.editors.clear)}
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
        {name} <span className="text-xs text-muted-foreground">{t($ => $.editors.raw)}</span>
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

export function getDefaultValue(schema?: ZodFieldSchema): unknown {
  if (!schema) return "";
  const type = schema.def.type;

  if (type === "default") return schema.def.defaultValue;
  if (type === "optional" || type === "nullable") return null;
  if (type === "pipe" && schema.def.out) return getDefaultValue(schema.def.out);

  switch (type) {
    case "string":
    case "email":
    case "url":
      return "";
    case "number":
    case "int":
      return 0;
    case "boolean":
      return false;
    case "date":
      return new Date().toISOString();
    case "enum":
      return schema.options?.[0] != null ? `${schema.options[0] as string | number}` : "";
    case "array":
      return [];
    case "record":
      return {};
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const [key, fieldSchema] of Object.entries(schema.shape ?? {})) {
        if (fieldSchema.def.type !== "optional") {
          obj[key] = getDefaultValue(fieldSchema);
        }
      }
      return obj;
    }
    case "union": {
      if (schema.def.discriminator && schema.def.options?.[0]) {
        return getDefaultValue(schema.def.options[0]);
      }
      return {};
    }
    default:
      return "";
  }
}
