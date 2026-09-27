import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { errorMessage } from "@/shared/errors";

interface PathDialogProps {
  title: string;
  description?: string;
  /** Shown above the input, e.g. what a rename would break. */
  children?: React.ReactNode;
  label?: string;
  placeholder?: string;
  hint?: string;
  initial: string;
  confirmLabel: string;
  pendingLabel?: string;
  isPending?: boolean;
  disabled?: boolean;
  /** Whether the initial value itself may be submitted, which a rename may not. */
  requireChange?: boolean;
  /** Why a value is refused, or null when it is accepted. */
  validate: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Prompts for a slash-separated path, reused wherever something is named or
 * renamed. Mounted only while open, so every opening starts from `initial`.
 */
export function PathDialog({
  title,
  description,
  children,
  label,
  placeholder,
  hint,
  initial,
  confirmLabel,
  pendingLabel,
  isPending = false,
  disabled = false,
  requireChange = false,
  validate,
  onSubmit,
  onCancel,
}: PathDialogProps) {
  const { t } = useTranslation();
  // Owned here, so a keystroke re-renders the dialog rather than its caller.
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const error = trimmed ? validate(trimmed) : null;
  const canSubmit = !!trimmed && !error && !isPending && !disabled && !(requireChange && trimmed === initial);

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();

            if (canSubmit) onSubmit(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <div className="mt-3 space-y-1">
            {label && <Label>{label}</Label>}
            <Input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              title={hint}
              autoFocus
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t(($) => $.common.cancel)}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending && pendingLabel ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The message a throwing validator refuses a value with, or null when it accepts it. */
export function refusal(validate: (value: string) => void, value: string): string | null {
  try {
    validate(value);

    return null;
  } catch (e) {
    return errorMessage(e);
  }
}
