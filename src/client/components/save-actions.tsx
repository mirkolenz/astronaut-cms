import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { matchesShortcut, useShortcut } from "@/client/hooks/use-shortcut";
import { Shortcut } from "@/client/components/shortcut";
import { Button } from "@/client/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";

const SAVE = ["mod", "S"];

interface SaveProps {
  /** Whether there is anything to save. */
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}

interface SaveActionsProps extends SaveProps {
  /** Whether cancelling does anything even without changes, such as leaving a draft. */
  canCancel?: boolean;
  onCancel: () => void;
  /** Where the save shortcut works: anywhere on the page, or only where `saveOnKey` handles it. */
  shortcut: "page" | "none";
}

function saveIfDirty({ dirty, saving, onSave }: SaveProps): void {
  if (dirty && !saving) onSave();
}

/** Saves on the save shortcut pressed inside an element, instead of the browser saving the page. */
export function saveOnKey(event: KeyboardEvent, props: SaveProps): void {
  if (!matchesShortcut(event, SAVE)) return;

  event.preventDefault();
  saveIfDirty(props);
}

/** Cancel and Save for an entry's edits, the same wherever an entry is edited. */
export function SaveActions({
  dirty,
  saving,
  onSave,
  canCancel = dirty,
  onCancel,
  shortcut,
}: SaveActionsProps) {
  const { t } = useTranslation();

  useShortcut(SAVE, () => saveIfDirty({ dirty, saving, onSave }), shortcut === "page");

  return (
    <>
      <Button variant="outline" onClick={onCancel} disabled={!canCancel || saving}>
        {t(($) => $.common.cancel)}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button onClick={onSave} disabled={!dirty || saving}>
            {saving ? t(($) => $.common.saving) : t(($) => $.common.save)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <Shortcut keys={SAVE} />
        </TooltipContent>
      </Tooltip>
    </>
  );
}
