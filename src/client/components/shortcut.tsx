import { Kbd, KbdGroup } from "@/client/components/ui/kbd";

const isApple = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** A key combination, where "mod" is Cmd on Apple devices and Ctrl elsewhere. */
export function Shortcut({ keys }: { keys: readonly string[] }) {
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key === "mod" ? (isApple ? "⌘" : "Ctrl") : key}</Kbd>
      ))}
    </KbdGroup>
  );
}
