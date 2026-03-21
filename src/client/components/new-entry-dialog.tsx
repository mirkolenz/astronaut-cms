import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { validateSegment } from "@/shared/validation";
import { CONTENT_FORMATS, DATA_FORMATS } from "@/shared/types";
import { useDialog } from "@/client/lib/use-dialog";

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
  const dialogRef = useDialog(open);
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

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="rounded-lg border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    >
      <form onSubmit={handleSubmit} className="w-80 p-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t($ => $.newEntryDialog.title, { collection })}
        </h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t($ => $.newEntryDialog.entryId)}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t($ => $.newEntryDialog.placeholder)}
              pattern="[a-zA-Z0-9_-]+"
              title={t($ => $.newEntryDialog.validationHint)}
              required
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900"
            />
          </div>
          {formats.length > 1 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t($ => $.newEntryDialog.format)}
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
              >
                {formats.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t($ => $.common.cancel)}
          </button>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t($ => $.common.create)}
          </button>
        </div>
      </form>
    </dialog>
  );
}
