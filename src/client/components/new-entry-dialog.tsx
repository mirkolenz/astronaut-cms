import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { join } from "pathe";
import { usePathRefusal } from "@/client/hooks/use-path-refusal";
import { localeLabel } from "@/shared/i18n";
import { CONTENT_FORMATS, DATA_FORMATS, type EntryFormat } from "@/shared/types";
import { FormDialog } from "@/client/components/form-dialog";
import { PathForm } from "@/client/components/path-dialog";
import { Field, FieldLabel } from "@/client/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

interface NewEntryDialogProps {
  open: boolean;
  collection: string;
  collectionType: "content" | "data";
  /** Ids already in the collection, which a new entry may not take. */
  existingIds: readonly string[];
  /** Folder the entry is created in, below any locale; the typed id is appended to it. */
  basePath?: string;
  /** Content languages, when the collection is organized by locale. */
  locales?: string[];
  /** Language preselected in that case, i.e. the one being browsed. */
  locale?: string | null;
  /** Allow slash-separated ids that create nested folders (glob collections). */
  nested?: boolean;
  allowedFormats?: string[] | null;
  onSubmit: (id: string, format: EntryFormat) => void;
  onCancel: () => void;
}

export function NewEntryDialog({ open, ...props }: NewEntryDialogProps) {
  return (
    <FormDialog open={open} onCancel={props.onCancel}>
      <NewEntryForm {...props} />
    </FormDialog>
  );
}

function NewEntryForm({
  collection,
  collectionType,
  existingIds,
  basePath,
  locales,
  locale,
  nested = false,
  allowedFormats,
  onSubmit,
  onCancel,
}: Omit<NewEntryDialogProps, "open">) {
  const { t } = useTranslation();
  const refusal = usePathRefusal();
  const taken = new Set(existingIds);
  const allFormats = collectionType === "content" ? CONTENT_FORMATS : DATA_FORMATS;
  const formats: readonly EntryFormat[] = allowedFormats
    ? allFormats.filter((f) => allowedFormats.includes(f))
    : allFormats;
  const [entryLocale, setEntryLocale] = useState(locale ?? "");
  const [format, setFormat] = useState<EntryFormat>(formats[0] ?? allFormats[0]);

  // The stored id is `<locale>/<folder>/<name>`, so picking a language here is
  // what puts the file in the right content directory.
  const prefix = [entryLocale, basePath].filter(Boolean).join("/");
  const fullId = (id: string): string => join(prefix, id);

  return (
    <PathForm
      title={t(($) => $.newEntryDialog.title, { collection })}
      label={t(($) => $.newEntryDialog.entryId)}
      placeholder={t(($) => $.newEntryDialog.placeholder)}
      hint={
        nested ? t(($) => $.newEntryDialog.validationHint) : t(($) => $.newEntryDialog.segmentHint)
      }
      prefix={prefix}
      confirmLabel={t(($) => $.common.create)}
      validate={(id) => refusal.id(id, nested, (value) => taken.has(fullId(value)))}
      onSubmit={(id) => onSubmit(fullId(id), format)}
      onCancel={onCancel}
    >
      <SelectField
        label={t(($) => $.i18n.language)}
        value={entryLocale}
        options={locales ?? []}
        render={localeLabel}
        onChange={setEntryLocale}
      />
      <SelectField
        label={t(($) => $.newEntryDialog.format)}
        value={format}
        options={formats}
        render={(f) => `.${f}`}
        onChange={setFormat}
      />
    </PathForm>
  );
}

/** A labeled choice among `options`, shown only when there is more than one. */
function SelectField<T extends string>({
  label,
  value,
  options,
  render,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  render: (option: T) => ReactNode;
  onChange: (value: T) => void;
}) {
  const id = useId();

  if (options.length < 2) return null;

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          const picked = options.find((option) => option === next);

          if (picked) onChange(picked);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {render(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
