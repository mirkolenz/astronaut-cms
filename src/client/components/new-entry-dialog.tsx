import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { validatePath, validateSegment } from "@shared/validation";
import { localeLabel } from "@shared/i18n";
import { CONTENT_FORMATS, DATA_FORMATS, type EntryFormat } from "@shared/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Input } from "@client/components/ui/input";
import { Label } from "@client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@client/components/ui/select";

interface NewEntryDialogProps {
  open: boolean;
  collection: string;
  collectionType: "content" | "data";
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

const CONTENT_FORMAT_OPTIONS = CONTENT_FORMATS.map((f) => ({ value: f, label: `.${f}` }));
const DATA_FORMAT_OPTIONS = DATA_FORMATS.map((f) => ({ value: f, label: `.${f}` }));

export function NewEntryDialog({
  open,
  collection,
  collectionType,
  basePath,
  locales,
  locale,
  nested,
  allowedFormats,
  onSubmit,
  onCancel,
}: NewEntryDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [id, setId] = useState("");
  const initialLocale = locale ?? "";
  const [entryLocale, setEntryLocale] = useState(initialLocale);
  const allFormats = collectionType === "content" ? CONTENT_FORMAT_OPTIONS : DATA_FORMAT_OPTIONS;
  const formats = useMemo(
    () =>
      allowedFormats ? allFormats.filter((f) => allowedFormats.includes(f.value)) : allFormats,
    [allFormats, allowedFormats],
  );
  const [format, setFormat] = useState<EntryFormat>(formats[0]?.value ?? allFormats[0].value);

  useEffect(() => {
    if (open) {
      setId("");
      setFormat(formats[0].value);
      setEntryLocale(initialLocale);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, formats, initialLocale]);

  // The stored id is `<locale>/<folder>/<name>`, so picking a language here is
  // what puts the file in the right content directory.
  const prefix = [entryLocale, basePath].filter(Boolean).join("/");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    const fullId = [prefix, trimmed].filter(Boolean).join("/");
    try {
      if (nested) validatePath(fullId, "entry ID");
      else validateSegment(fullId, "entry ID");
    } catch {
      return;
    }
    onSubmit(fullId, format);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t(($) => $.newEntryDialog.title, { collection })}</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-3">
            {locales && locales.length > 1 && (
              <div>
                <Label>{t(($) => $.i18n.language)}</Label>
                <Select value={entryLocale} onValueChange={setEntryLocale}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locales.map((l) => (
                      <SelectItem key={l} value={l}>
                        {localeLabel(l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{t(($) => $.newEntryDialog.entryId)}</Label>
              <div className="flex items-center gap-1">
                {prefix && (
                  <span className="shrink-0 text-sm text-muted-foreground">{prefix}/</span>
                )}
                <Input
                  ref={inputRef}
                  type="text"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder={t(($) => $.newEntryDialog.placeholder)}
                  pattern={nested ? "[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*" : "[a-zA-Z0-9_-]+"}
                  title={t(($) => $.newEntryDialog.validationHint)}
                  required
                />
              </div>
            </div>
            {formats.length > 1 && (
              <div>
                <Label>{t(($) => $.newEntryDialog.format)}</Label>
                <Select value={format} onValueChange={(value) => setFormat(value as EntryFormat)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {formats.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t(($) => $.common.cancel)}
            </Button>
            <Button type="submit">{t(($) => $.common.create)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
