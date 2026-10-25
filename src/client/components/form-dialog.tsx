import type { ReactNode } from "react";
import { cn } from "cn";
import { Dialog, DialogContent } from "@/client/components/ui/dialog";

interface FormDialogProps {
  open: boolean;
  className?: string;
  /** Mounted only while open, so state held below starts fresh with every opening. */
  children: ReactNode;
  onCancel: () => void;
}

/** The frame of a dialog that is dismissed through its own Cancel button rather than a corner X. */
export function FormDialog({ open, className, children, onCancel }: FormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className={cn("sm:max-w-sm", className)}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
