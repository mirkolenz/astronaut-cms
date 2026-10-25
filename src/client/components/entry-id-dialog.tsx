import { useTranslation } from "react-i18next";
import { PathDialog } from "@/client/components/path-dialog";
import { usePathRefusal } from "@/client/hooks/use-path-refusal";

interface EntryIdDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  pendingLabel?: string;
  isPending?: boolean;
  initialValue?: string;
  requireChange?: boolean;
  existingIds: string[];
  onSubmit: (id: string) => void;
  onCancel: () => void;
}

// Prompts for a new entry id, reused by rename and duplicate. Enforces the same
// path rules as new-entry creation (slashes allowed for nested folders) and
// rejects ids already taken in the collection, surfacing the reason inline.
export function EntryIdDialog({ existingIds, ...props }: EntryIdDialogProps) {
  const { t } = useTranslation();
  const refusal = usePathRefusal();

  return (
    <PathDialog
      label={t(($) => $.newEntryDialog.entryId)}
      placeholder={t(($) => $.newEntryDialog.placeholder)}
      hint={t(($) => $.newEntryDialog.validationHint)}
      validate={(id) => refusal.id(id, true, (value) => existingIds.includes(value))}
      {...props}
    />
  );
}
