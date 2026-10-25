import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/client/components/ui/input-group";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/client/components/ui/field";
import { FormDialog } from "@/client/components/form-dialog";

interface PathFormProps {
  title: string;
  description?: string;
  /** Shown above the input, e.g. what a rename would break. */
  children?: ReactNode;
  label?: string;
  placeholder?: string;
  hint?: string;
  /** Fixed text in front of the input, which the submitted value does not include. */
  prefix?: string;
  initialValue?: string;
  confirmLabel: string;
  pendingLabel?: string;
  isPending?: boolean;
  disabled?: boolean;
  /** Whether the initial value itself may be submitted, which a rename may not. */
  requireChange?: boolean;
  /**
   * Why a value is refused, or null when it is accepted.
   * Never asked about the initial value, so a rename's current name does not count as taken.
   */
  validate: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Prompts for a slash-separated path, reused wherever something is named or
 * renamed. Its form mounts only while open, so every opening starts from `initialValue`.
 */
export function PathDialog({ open, ...props }: PathFormProps & { open: boolean }) {
  return (
    <FormDialog open={open} onCancel={props.onCancel}>
      <PathForm {...props} />
    </FormDialog>
  );
}

/** The body of {@link PathDialog}, for a dialog that keeps more state around the path. */
export function PathForm({
  title,
  description,
  children,
  label,
  placeholder,
  hint,
  prefix,
  initialValue = "",
  confirmLabel,
  pendingLabel,
  isPending = false,
  disabled = false,
  requireChange = false,
  validate,
  onSubmit,
  onCancel,
}: PathFormProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const messageId = useId();
  // Owned here, so a keystroke re-renders the dialog rather than its caller.
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  // A rename's current name is never refused, it just cannot be submitted.
  const unchanged = requireChange && trimmed === initialValue;
  const error = trimmed && !unchanged ? validate(trimmed) : null;
  const message = error ?? hint;
  const canSubmit = !!trimmed && !error && !isPending && !disabled && !unchanged;

  return (
    <form
      className="grid gap-4"
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
      <Field data-invalid={!!error}>
        {label && <FieldLabel htmlFor={inputId}>{label}</FieldLabel>}
        <InputGroup>
          {prefix && (
            <InputGroupAddon>
              <InputGroupText>{prefix}/</InputGroupText>
            </InputGroupAddon>
          )}
          <InputGroupInput
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            aria-invalid={!!error}
            aria-describedby={message ? messageId : undefined}
            autoFocus
            required
          />
        </InputGroup>
        {error ? (
          <FieldError id={messageId}>{error}</FieldError>
        ) : (
          hint && <FieldDescription id={messageId}>{hint}</FieldDescription>
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t(($) => $.common.cancel)}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {isPending && pendingLabel ? pendingLabel : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
