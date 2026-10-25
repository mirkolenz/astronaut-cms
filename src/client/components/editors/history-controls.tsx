import { useTranslation } from "react-i18next";
import { Redo2, Undo2 } from "lucide-react";
import { redo, undo, useCanRedo, useCanUndo } from "@/client/stores/form-store";
import { textEditorAt } from "@/client/lib/text-editors";
import { useShortcut } from "@/client/hooks/use-shortcut";
import { IconButton } from "@/client/components/icon-button";

const UNDO = ["mod", "Z"];
const REDO = ["mod", "Shift", "Z"];
const REDO_ALT = ["mod", "Y"];

/**
 * Whether the keys undo the page where the event happens. They undo text in the
 * text editors, which take them into the page's history themselves, and in text
 * inputs not bound to that history, such as a search. Inputs bound to it carry
 * `data-page-history`, so the keys undo the page there.
 */
function undoesPage({ target }: KeyboardEvent): boolean {
  if (!(target instanceof Element)) return true;

  if (textEditorAt(target)) return false;

  return (
    !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) ||
    target.hasAttribute("data-page-history")
  );
}

/**
 * Undo and redo for the page, as buttons and as the usual keys. The text
 * editors take the keys themselves, into the same history.
 */
export function HistoryControls() {
  const { t } = useTranslation();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  useShortcut(UNDO, undo, undoesPage);
  useShortcut(REDO, redo, undoesPage);
  useShortcut(REDO_ALT, redo, undoesPage);

  return (
    <div className="flex">
      <IconButton
        size="icon"
        label={t(($) => $.common.undo)}
        shortcut={UNDO}
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2 />
      </IconButton>
      <IconButton
        size="icon"
        label={t(($) => $.common.redo)}
        shortcut={REDO}
        disabled={!canRedo}
        onClick={redo}
      >
        <Redo2 />
      </IconButton>
    </div>
  );
}
