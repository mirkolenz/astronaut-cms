import { useTranslation } from "react-i18next";
import { validatePath } from "@/shared/validation";
import { PathDialog, refusal } from "@/client/components/path-dialog";

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

  if (!open) return null;

  return (
    <PathDialog
      title={title}
      label={t(($) => $.newEntryDialog.entryId)}
      placeholder={t(($) => $.newEntryDialog.placeholder)}
      hint={t(($) => $.newEntryDialog.validationHint)}
      initial={initialId}
      confirmLabel={confirmLabel}
      validate={(id) =>
        refusal((value) => validatePath(value, "entry ID"), id) ??
        (existingIds.includes(id) ? t(($) => $.entry.entryIdExists, { id }) : null)
      }
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}
