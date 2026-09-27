import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Redo2, Undo2 } from "lucide-react";
import { redo, undo, useCanRedo, useCanUndo } from "@/client/stores/form-store";
import { Button } from "@/client/components/ui/button";

/**
 * Undo and redo for the page, as buttons and as the usual keys. The text
 * editors take the keys themselves, into the same history.
 */
export function HistoryControls() {
  const { t } = useTranslation();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const target = event.target;

      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        (key !== "z" && key !== "y") ||
        event.defaultPrevented ||
        (target instanceof Element && target.closest('[contenteditable="true"], .cm-editor'))
      ) {
        return;
      }

      event.preventDefault();

      if (key === "y" || event.shiftKey) redo();
      else undo();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex">
      <Button variant="ghost" size="icon" aria-label={t(($) => $.common.undo)} disabled={!canUndo} onClick={undo}>
        <Undo2 />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t(($) => $.common.redo)} disabled={!canRedo} onClick={redo}>
        <Redo2 />
      </Button>
    </div>
  );
}
