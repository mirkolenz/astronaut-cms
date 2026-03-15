import { useEffect, useRef } from "react";

export function useDialog(open: boolean): React.RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return dialogRef;
}
