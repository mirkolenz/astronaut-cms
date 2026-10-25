import { useEffect, useEffectEvent } from "react";

/** A key combination as `Shortcut` shows it, where "mod" is Cmd or Ctrl. */
export type ShortcutKeys = readonly string[];

type KeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** Whether the event presses exactly the keys, the last being the key and the others modifiers. */
export function matchesShortcut(event: KeyEvent, keys: ShortcutKeys): boolean {
  const modifiers = {
    mod: event.metaKey || event.ctrlKey,
    Shift: event.shiftKey,
    Alt: event.altKey,
  };

  return (
    event.key.toLowerCase() === keys.at(-1)?.toLowerCase() &&
    Object.entries(modifiers).every(([name, pressed]) => keys.includes(name) === pressed)
  );
}

/**
 * Runs `handler` instead of the browser's default on the keys anywhere on the
 * page, unless something handled them already or `enabled` says otherwise.
 */
export function useShortcut(
  keys: ShortcutKeys,
  handler: () => void,
  enabled: boolean | ((event: KeyboardEvent) => boolean) = true,
): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      !matchesShortcut(event, keys) ||
      !(typeof enabled === "function" ? enabled(event) : enabled)
    ) {
      return;
    }

    event.preventDefault();
    handler();
  });

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
