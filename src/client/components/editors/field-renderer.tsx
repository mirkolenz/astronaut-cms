import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import {
  Asterisk,
  Braces,
  ChevronsUpDown,
  File as FileIcon,
  Image as ImageIcon,
  Link as LinkIcon,
  Plus,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { isRequired, type FieldSchema } from "@/shared/field-schema";
import { mediaRef, type MediaLocation } from "@/shared/media";
import config from "@/client/lib/config";
import { arrayMove } from "@/client/lib/arrays";
import {
  asArray,
  asRecord,
  collectionItems,
  collectionMissing,
  collectionOf,
  collectionSummary,
  emptyValue,
  fieldLabel,
  followKeys,
  freeKey,
  getDefaultValue,
  isBlank,
  isUnsettable,
  missingFields,
  seedValue,
  showsEmpty,
  switchVariant,
  variantLabel,
  type CollectionField,
  type ItemKey,
  type ValuePath,
} from "@/client/lib/field-values";
import { collectionLabel } from "@/client/lib/collections";
import { activeVariant } from "@/shared/field-to-zod";
import { useEntries } from "@/client/queries/use-entries";
import { MediaPickerDialog } from "@/client/components/media-picker-dialog";
import { SortableList } from "@/client/components/sortable-list";
import { IconButton } from "@/client/components/icon-button";
import { DisclosureChevron } from "@/client/components/disclosure-chevron";
import { AssetThumbnail } from "@/client/components/editors/asset-thumbnail";
import { BlockRowButton, MissingProps } from "@/client/components/editors/block-controls";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { Switch } from "@/client/components/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/client/components/ui/field";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/client/components/ui/popover";
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
export const FieldNavContext = createContext<{
  selected: ValuePath;
  open: (path: ValuePath) => void;
}>({
  selected: [],
  open: () => {},
});

/** What every field is shown with: its label, whether it is required, and its description. */
interface ShellProps {
  /** Left out for a field whose container already names it, such as an array item. */
  label?: string;
  required?: boolean;
  description?: string;
  /** Clears a field that may do without a value, while it has one. */
  onClear?: () => void;
}

interface FieldProps<V> extends ShellProps {
  value: V;
  onChange: (value: unknown) => void;
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

export function FieldRenderer({
  schema,
  value,
  onChange,
  label,
  required,
  path = [],
}: FieldRendererProps) {
  const blank = isBlank(value);
  const unsettable = isUnsettable(schema);
  const shell: ShellProps = {
    label,
    required,
    description: schema.description,
    onClear: unsettable && !blank ? () => onChange(emptyValue(schema)) : undefined,
  };

  if (unsettable && blank && !showsEmpty(schema)) {
    return <UnsetField {...shell} onSet={() => onChange(seedValue(schema))} />;
  }

  // An emptied input leaves the field as it is without a value.
  const common = {
    ...shell,
    onChange: (next: unknown) => onChange(next === "" ? emptyValue(schema) : next),
  };
  const resolved = value === undefined ? schema.default : value;

  switch (schema.type) {
    case "image":
      return <ImageField {...common} value={asString(resolved)} repoOnly={schema.repoOnly} />;

    case "file":
      return <FileField {...common} value={asString(resolved)} />;

    case "reference":
      return (
        <ReferenceField {...common} value={asString(resolved)} collection={schema.collection} />
      );

    case "string":
      if (schema.format === "email" || schema.format === "url") {
        return <StringField {...common} value={asString(resolved)} format={schema.format} />;
      }

      if (schema.multiline) {
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
      // An option may be an empty text, which is chosen as it is.
      return (
        <EnumField
          {...shell}
          onChange={onChange}
          options={schema.options}
          labels={schema.labels}
          value={resolved}
        />
      );

    case "array":
    case "record": {
      const collection = collectionOf(schema);

      if (collection)
        return <CollectionRow {...shell} schema={collection} value={resolved} path={path} />;

      return schema.type === "array" ? (
        <ArrayField {...common} element={schema.element} value={asArray(resolved)} />
      ) : (
        <RecordField {...common} valueSchema={schema.value} value={asRecord(resolved)} />
      );
    }

    case "tuple":
      return <TupleField {...common} items={schema.items} value={asArray(resolved)} path={path} />;

    case "object":
      return (
        <ObjectField {...common} shape={schema.shape} value={asRecord(resolved)} path={path} />
      );

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
 * them as a section that opens on demand. Wide enough, the labels are a column
 * next to the controls.
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
      onChange={(value) => onChange(key, value)}
      label={fieldLabel(key, field)}
      required={isRequired(field)}
      path={[...path, key]}
    />
  );

  return (
    <FieldGroup>
      {groups.get("")?.map(render)}
      {[...groups].flatMap(([group, fields]) =>
        group
          ? [
              <Collapsible key={group} className="rounded-md border border-border">
                <CollapsibleTrigger className="group/disclosure flex w-full items-center gap-1 px-3 py-2 text-sm font-medium">
                  <DisclosureChevron className="size-4 text-muted-foreground" />
                  {group}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {fields.length}
                  </span>
                  <MissingProps
                    labels={missingFields(Object.fromEntries(fields), (key) =>
                      isBlank(values[key]),
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent asChild>
                  <FieldGroup className="border-t border-border p-3">
                    {fields.map(render)}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>,
            ]
          : [],
      )}
    </FieldGroup>
  );
}

/**
 * The props of a field's control: the id its label names it by, and the marker
 * that binds it to the page's history, so undo there undoes the page rather than the text.
 */
interface ControlProps {
  id: string;
  "data-page-history": true;
}

/**
 * A field's label, control and description. Given as a function, the control
 * gets its props from the field, else the field is a set of controls its legend names.
 */
function FieldShell({
  label,
  required,
  hint,
  description,
  invalid,
  onClear,
  children,
}: ShellProps & {
  /** What kind of value the field takes, where its input does not show it. */
  hint?: { icon: LucideIcon; text: string };
  invalid?: boolean;
  children: ReactNode | ((control: ControlProps) => ReactNode);
}) {
  const { t } = useTranslation();
  const id = useId();
  const single = typeof children === "function";
  const content = (
    <FieldContent className="min-w-0 gap-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          {single ? children({ id, "data-page-history": true }) : children}
        </div>
        {onClear && (
          <IconButton label={t(($) => $.editors.clear)} className="mt-1.5" onClick={onClear}>
            <X />
          </IconButton>
        )}
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
    </FieldContent>
  );

  // Unlabelled, the field is one its container already names, such as an item of a list.
  if (!label) return content;

  const caption = (
    <>
      <span>
        {label}
        {/* A word joiner, so the marker never wraps onto a line of its own. */}
        {required && (
          <span className="text-destructive">
            {"\u2060"}
            <Asterisk className="ml-0.5 inline size-3 align-text-top" />
            <span className="sr-only">{t(($) => $.editors.required)}</span>
          </span>
        )}
      </span>
      {hint && (
        <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
          <hint.icon className="size-3" />
          {hint.text}
        </span>
      )}
    </>
  );

  if (!single) {
    return (
      <FieldSet className="min-w-0" data-invalid={invalid}>
        <FieldLegend variant="label" className="flex flex-wrap items-center gap-2">
          {caption}
        </FieldLegend>
        {content}
      </FieldSet>
    );
  }

  return (
    <Field orientation="responsive" data-invalid={invalid}>
      <FieldLabel
        htmlFor={id}
        className="flex-wrap @md/field-group:min-h-9 @md/field-group:max-w-36"
      >
        {caption}
      </FieldLabel>
      {content}
    </Field>
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
      {(control) => (
        <Input
          {...control}
          type={format ?? "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

function TextareaField({ value, onChange, ...shell }: FieldProps<string>) {
  return (
    <FieldShell {...shell}>
      {(control) => (
        <Textarea {...control} value={value} onChange={(e) => onChange(e.target.value)} rows={4} />
      )}
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
      {(control) => (
        <Input
          {...control}
          type="number"
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value;

            onChange(v === "" ? "" : integer ? parseInt(v, 10) : parseFloat(v));
          }}
          step={integer ? 1 : "any"}
        />
      )}
    </FieldShell>
  );
}

function BooleanField({ value, onChange, ...shell }: FieldProps<boolean>) {
  return (
    <FieldShell {...shell}>
      {(control) => (
        <div className="flex min-h-9 items-center">
          <Switch {...control} checked={value} onCheckedChange={(checked) => onChange(checked)} />
        </div>
      )}
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
      {(control) => (
        <Input
          {...control}
          type="datetime-local"
          value={dateStr}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")}
        />
      )}
    </FieldShell>
  );
}

function EnumField({
  options,
  labels,
  value,
  onChange,
  ...shell
}: FieldProps<unknown> & {
  options: (string | number | boolean | null)[];
  labels?: Record<string, string>;
}) {
  const selected = options.findIndex((option) => Object.is(option, value));

  return (
    <FieldShell {...shell}>
      {(control) => (
        <Select
          value={selected < 0 ? "" : String(selected)}
          onValueChange={(index) => {
            const option = options[Number(index)];

            if (option !== undefined) onChange(option);
          }}
        >
          <SelectTrigger {...control} className="w-full">
            <SelectValue placeholder={<ChoosePlaceholder />} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option, index) => (
              <SelectItem key={index} value={String(index)}>
                {labels?.[String(option)] ?? String(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
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
    <FieldShell
      {...shell}
      hint={{ icon: assetType === "image" ? ImageIcon : FileIcon, text: kind }}
    >
      {(control) => (
        <>
          <div className="flex gap-2">
            <Input
              {...control}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={kind}
              className="flex-1"
            />
            <Button type="button" variant="outline" onClick={() => setShowPicker(true)}>
              {t(($) => $.editors.browse)}
            </Button>
          </div>
          {children}
          <MediaPickerDialog
            open={showPicker}
            kind={assetType === "image" ? "image" : undefined}
            repoOnly={repoOnly}
            onSelect={handleSelect}
            onCancel={() => setShowPicker(false)}
          />
        </>
      )}
    </FieldShell>
  );
}

function ImageField(props: FieldProps<string> & { repoOnly?: boolean }) {
  return (
    <AssetField {...props} assetType="image">
      <AssetThumbnail
        src={props.value || undefined}
        className="size-24 rounded border border-border"
      />
    </AssetField>
  );
}

function FileField(props: FieldProps<string>) {
  return <AssetField {...props} assetType="file" />;
}

/** Picks an entry of a collection, searching them by id. */
function ReferenceField({
  value,
  onChange,
  collection,
  ...shell
}: FieldProps<string> & { collection: string }) {
  const { t } = useTranslation();
  const { data: entries, isLoading } = useEntries(collection);
  const [open, setOpen] = useState(false);
  const name = collectionLabel(collection);

  return (
    <FieldShell {...shell} hint={{ icon: LinkIcon, text: name }}>
      {(control) => (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              {...control}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal"
            >
              <span className={cn("truncate", !value && "text-muted-foreground")}>
                {value || t(($) => $.editors.selectFrom, { collection: name })}
              </span>
              <ChevronsUpDown className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
            <Command>
              <CommandInput placeholder={t(($) => $.editors.searchEntries)} />
              <CommandList>
                <CommandEmpty>
                  {isLoading ? t(($) => $.editors.loading) : t(($) => $.editors.nothingFound)}
                </CommandEmpty>
                {entries?.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.id}
                    data-checked={entry.id === value}
                    onSelect={() => {
                      onChange(entry.id);
                      setOpen(false);
                    }}
                  >
                    {entry.id}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
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
    onChange(
      items.map((item, i) => (i === index ? newValue : (value[i] ?? getDefaultValue(item)))),
    );
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

/** Keys that follow the items of a list through any change, so their local state stays with them. */
function useItemKeys(items: readonly unknown[]): string[] {
  const [state, setState] = useState<{ items?: readonly unknown[]; keys: readonly ItemKey[] }>({
    keys: [],
  });
  const keys = state.items === items ? state.keys : followKeys(state.keys, items);

  if (state.items !== items) setState({ items, keys });

  return keys.map(({ key }) => key);
}

/** A list of single values, such as tags, edited in place. */
function ArrayField({
  element,
  value,
  onChange,
  ...shell
}: FieldProps<unknown[]> & { element: FieldSchema }) {
  const { t } = useTranslation();
  const keys = useItemKeys(value);

  return (
    <FieldShell {...shell}>
      <div className="space-y-2">
        <SortableList
          items={value}
          getKey={(_, index) => keys[index] ?? String(index)}
          onMove={(from, to) => onChange(arrayMove(value, from, to))}
          className="space-y-2"
        >
          {(item, index, handle) => (
            <div className="flex items-center gap-2">
              {handle}
              <div className="min-w-0 flex-1">
                <FieldRenderer
                  schema={element}
                  value={item}
                  onChange={(v) => onChange(value.with(index, v))}
                />
              </div>
              <IconButton
                label={t(($) => $.common.remove)}
                onClick={() => onChange(value.toSpliced(index, 1))}
              >
                <Trash2 />
              </IconButton>
            </div>
          )}
        </SortableList>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onChange([...value, getDefaultValue(element)])}
        >
          <Plus />
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
}: ShellProps & { schema: CollectionField; value: unknown; path: ValuePath }) {
  const { open } = useContext(FieldNavContext);
  const items = collectionItems(schema, value);

  return (
    <FieldShell {...shell}>
      <BlockRowButton
        label={collectionSummary(schema, items)}
        count={items.length}
        missing={collectionMissing(schema, items)}
        onOpen={() => open(path)}
        inspects
        variant="outline"
      />
    </FieldShell>
  );
}

function ObjectField({
  shape,
  value,
  onChange,
  path,
  ...shell
}: FieldProps<Record<string, unknown>> & { shape: Record<string, FieldSchema>; path: ValuePath }) {
  const fields = (
    <FieldList
      shape={shape}
      values={value}
      onChange={(key, v) => onChange({ ...value, [key]: v })}
      path={path}
    />
  );

  return (
    <FieldShell {...shell}>
      {/* Unlabelled, the object is an item its container already frames. */}
      {shell.label ? <div className="rounded-md border border-border p-3">{fields}</div> : fields}
    </FieldShell>
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
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;

          e.preventDefault();
          add();
        }}
        placeholder={t(($) => $.editors.newKey)}
        aria-label={t(($) => $.editors.newKey)}
        className="h-7 max-w-48"
      />
      <Button type="button" variant="outline" size="xs" onClick={add}>
        <Plus />
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
  const entries = Object.entries(value);

  return (
    <FieldShell {...shell}>
      <div className="space-y-3 rounded-md border border-border p-3">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-start gap-2">
            <span className="mt-1.5 shrink-0 font-mono text-xs text-muted-foreground">{key}</span>
            <div className="min-w-0 flex-1">
              <FieldRenderer
                schema={valueSchema}
                value={val}
                onChange={(v) => onChange({ ...value, [key]: v })}
              />
            </div>
            <IconButton
              label={t(($) => $.common.remove)}
              onClick={() =>
                onChange(Object.fromEntries(entries.filter(([other]) => other !== key)))
              }
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
        <NewKeyInput
          onAdd={(key) =>
            onChange({ ...value, [freeKey(entries, key)]: getDefaultValue(valueSchema) })
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
        value={selectedIndex >= 0 ? String(selectedIndex) : ""}
        onValueChange={(index) => onChange(switchVariant(schema, value, Number(index)))}
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

/** A field that may do without a value and has none, until one is set. */
function UnsetField({ onSet, ...shell }: ShellProps & { onSet: () => void }) {
  const { t } = useTranslation();

  return (
    <FieldShell {...shell}>
      <div>
        <Button type="button" variant="outline" size="xs" onClick={onSet}>
          {t(($) => $.editors.setValue)}
        </Button>
      </div>
    </FieldShell>
  );
}

// No value is written as an empty text.
const toJson = (value: unknown): string => (isBlank(value) ? "" : JSON.stringify(value, null, 2));

function parseJson(text: string): { value: unknown } | undefined {
  if (!text.trim()) return { value: "" };

  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** Any value as JSON, written only while it is valid. */
function FallbackField({ value, onChange, ...shell }: FieldProps<unknown>) {
  const { t } = useTranslation();
  const errorId = useId();
  const json = useMemo(() => toJson(value), [value]);
  // What is typed, until the value changes elsewhere, such as by an undo.
  const [draft, setDraft] = useState<{ text: string; json: string; invalid: boolean }>();
  const current = draft?.json === json ? draft : undefined;
  const text = current?.text ?? json;
  const invalid = current?.invalid ?? false;

  return (
    <FieldShell {...shell} hint={{ icon: Braces, text: t(($) => $.editors.raw) }} invalid={invalid}>
      {(control) => (
        <>
          <Textarea
            {...control}
            value={text}
            onChange={(e) => {
              const parsed = parseJson(e.target.value);

              setDraft({
                text: e.target.value,
                json: parsed ? toJson(parsed.value) : json,
                invalid: !parsed,
              });

              if (parsed) onChange(parsed.value);
            }}
            rows={3}
            className="font-mono"
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
          />
          {invalid && <FieldError id={errorId}>{t(($) => $.editors.invalidJson)}</FieldError>}
        </>
      )}
    </FieldShell>
  );
}
