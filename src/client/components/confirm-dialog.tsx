import { useTranslation } from "react-i18next";
import { useDialog } from "@/client/lib/use-dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useDialog(open);
  const resolvedConfirmLabel = confirmLabel ?? t($ => $.common.confirm);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="rounded-lg border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    >
      <div className="w-80 p-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t($ => $.common.cancel)}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors ${
              variant === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
