import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { validatePath } from "@shared/validation";
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

interface EntryIdDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  initialId?: string;
  existingIds: string[];
  onSubmit: (id: string) => void;
  onCancel: () => void;
}

// Prompts for a new entry id, reused by rename and duplicate. Enforces the same
// path rules as new-entry creation (slashes allowed for nested folders) and
// rejects ids already taken in the collection, surfacing the reason inline.
export function EntryIdDialog({
  open,
  title,
  confirmLabel,
  initialId = "",
  existingIds,
  onSubmit,
  onCancel,
}: EntryIdDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [id, setId] = useState(initialId);

  useEffect(() => {
    if (open) {
      setId(initialId);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialId]);

  const trimmed = id.trim();
  const error = useMemo(() => {
    if (!trimmed) return null;

    try {
      validatePath(trimmed, "entry ID");
    } catch (e) {
      return (e as Error).message;
    }

    if (existingIds.includes(trimmed)) return t($ => $.entry.entryIdExists, { id: trimmed });

    return null;
  }, [trimmed, existingIds, t]);

  const canSubmit = trimmed.length > 0 && !error;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (canSubmit) onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-1">
            <Label>{t($ => $.newEntryDialog.entryId)}</Label>
            <Input
              ref={inputRef}
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t($ => $.newEntryDialog.placeholder)}
              title={t($ => $.newEntryDialog.validationHint)}
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t($ => $.common.cancel)}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
