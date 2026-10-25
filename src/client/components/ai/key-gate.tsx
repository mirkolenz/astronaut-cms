import { useId, useState } from "react";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import { useAiKeyStore } from "@/client/stores/ai-key-store";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/client/components/ui/field";

/**
 * Where an editor supplies their own gateway key, in the deployments that ask
 * for one instead of holding a shared credential.
 *
 * Deliberately plain about what happens to it: the key never reaches this site's
 * server, and it is gone when the tab closes.
 */
export function AiKeyGate({ className }: { className?: string }) {
  const { t } = useTranslation();
  const setKey = useAiKeyStore((state) => state.setKey);
  const [value, setValue] = useState("");
  const inputId = useId();
  const descriptionId = useId();

  return (
    <form
      className={cn("grid gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        setKey(value);
        setValue("");
      }}
    >
      <Field>
        <FieldLabel htmlFor={inputId}>{t(($) => $.ai.keyTitle)}</FieldLabel>
        <FieldDescription id={descriptionId}>{t(($) => $.ai.keyDescription)}</FieldDescription>
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t(($) => $.ai.keyPlaceholder)}
          aria-describedby={descriptionId}
        />
      </Field>
      <Button type="submit" disabled={!value.trim()} className="justify-self-start">
        {t(($) => $.ai.keySubmit)}
      </Button>
    </form>
  );
}

/** Forgets the key, for a shared machine or a rotated credential. */
export function AiKeyReset() {
  const { t } = useTranslation();
  const clearKey = useAiKeyStore((state) => state.clearKey);

  return (
    <Button variant="ghost" size="xs" onClick={clearKey}>
      {t(($) => $.ai.keyForget)}
    </Button>
  );
}
