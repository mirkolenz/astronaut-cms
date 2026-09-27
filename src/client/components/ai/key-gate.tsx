import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiKeyStore } from "@client/stores/ai-key-store";
import { Button } from "@client/components/ui/button";
import { Input } from "@client/components/ui/input";
import { Label } from "@client/components/ui/label";

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

  return (
    <form
      className={`grid gap-3 ${className ?? ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        setKey(value);
        setValue("");
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="astronaut-cms-ai-key">{t(($) => $.ai.keyTitle)}</Label>
        <p className="text-sm text-muted-foreground">{t(($) => $.ai.keyDescription)}</p>
      </div>
      <Input
        id="astronaut-cms-ai-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t(($) => $.ai.keyPlaceholder)}
      />
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
