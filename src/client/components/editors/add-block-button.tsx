import { useState, useRef, useEffect } from "react";
import type { ClientComponentDef } from "virtual:astronaut-cms/user-config";
import type { Block } from "@/client/lib/block-model";

interface AddBlockButtonProps {
  onAdd: (block: Block) => void;
  availableComponents: Record<string, ClientComponentDef>;
  showTextOption?: boolean;
}

export function AddBlockButton({
  onAdd,
  availableComponents,
  showTextOption = true,
}: AddBlockButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const entries = Object.entries(availableComponents);

  return (
    <div className="flex flex-col items-center" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-full border border-dashed border-gray-300 px-3 py-0.5 text-xs text-gray-400 transition-colors hover:border-blue-400 hover:text-blue-500 dark:border-gray-600 dark:hover:border-blue-500"
      >
        + Add block
      </button>
      {open && (
        <div className="z-10 mt-1 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {showTextOption && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              onClick={() => {
                onAdd({
                  id: crypto.randomUUID(),
                  type: "text",
                  content: "",
                });
                setOpen(false);
              }}
            >
              <span className="text-xs text-gray-400">T</span>
              Text
            </button>
          )}
          {entries.map(([name, def]) => (
            <button
              key={name}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              onClick={() => {
                onAdd({
                  id: crypto.randomUUID(),
                  type: "component",
                  name,
                  props: {},
                  children: [],
                });
                setOpen(false);
              }}
            >
              {def.icon && <span className="text-xs">{def.icon}</span>}
              {def.label}
            </button>
          ))}
          {!showTextOption && entries.length === 0 && (
            <span className="block px-3 py-1.5 text-xs text-gray-400">No components available</span>
          )}
        </div>
      )}
    </div>
  );
}
