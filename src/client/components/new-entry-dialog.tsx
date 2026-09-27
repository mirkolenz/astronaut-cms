import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { validateSegment } from "@shared/validation";
import { CONTENT_FORMATS, DATA_FORMATS } from "@shared/types";
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
  allowedFormats?: string[] | null;
  onSubmit: (id: string, format: string) => void;
  onCancel: () => void;
}

const CONTENT_FORMAT_OPTIONS = CONTENT_FORMATS.map((f) => ({ value: f, label: `.${f}` }));
const DATA_FORMAT_OPTIONS = DATA_FORMATS.map((f) => ({ value: f, label: `.${f}` }));

export function NewEntryDialog({
  open,
  collection,
  collectionType,
  allowedFormats,
  onSubmit,
  onCancel,
}: NewEntryDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [id, setId] = useState("");
  const allFormats = collectionType === "content" ? CONTENT_FORMAT_OPTIONS : DATA_FORMAT_OPTIONS;
  const formats = useMemo(
    () =>
      allowedFormats ? allFormats.filter((f) => allowedFormats.includes(f.value)) : allFormats,
    [allFormats, allowedFormats],
  );
  const [format, setFormat] = useState<string>(formats[0]?.value ?? allFormats[0].value);

  useEffect(() => {
    if (open) {
      setId("");
      setFormat(formats[0].value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, formats]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    try {
      validateSegment(trimmed, "entry ID");
    } catch {
      return;
    }
    onSubmit(trimmed, format);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t($ => $.newEntryDialog.title, { collection })}</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-3">
            <div>
              <Label>{t($ => $.newEntryDialog.entryId)}</Label>
              <Input
                ref={inputRef}
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder={t($ => $.newEntryDialog.placeholder)}
                pattern="[a-zA-Z0-9_-]+"
                title={t($ => $.newEntryDialog.validationHint)}
                required
              />
            </div>
            {formats.length > 1 && (
              <div>
                <Label>{t($ => $.newEntryDialog.format)}</Label>
                <Select value={format} onValueChange={setFormat}>
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
              {t($ => $.common.cancel)}
            </Button>
            <Button type="submit">
              {t($ => $.common.create)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
