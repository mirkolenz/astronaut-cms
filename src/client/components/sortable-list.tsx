import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical } from "lucide-react";
import { cn } from "cn";

interface SortableListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  onMove: (from: number, to: number) => void;
  /** Renders an item, with its drag `handle` placed wherever it belongs. */
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
  className?: string;
}

/** A list reordered by dragging an item's handle, or with the arrow keys while it has focus. */
export function SortableList<T>({ items, getKey, onMove, children, className }: SortableListProps<T>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // A moved item's handle can lose focus when its element is reinserted.
  useEffect(() => {
    if (focusKey === null) return;

    listRef.current
      ?.querySelector<HTMLElement>(`[data-sortable-key="${CSS.escape(focusKey)}"]`)
      ?.focus();
    setFocusKey(null);
  }, [focusKey]);

  return (
    <ul ref={listRef} className={className}>
      {items.map((item, index) => {
        const key = getKey(item, index);
        const handle = (
          <button
            type="button"
            draggable
            data-sortable-key={key}
            aria-label={t(($) => $.editors.reorder)}
            className="shrink-0 cursor-grab rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            onDragStart={(event) => {
              const row = event.currentTarget.closest("li");

              event.dataTransfer.effectAllowed = "move";
              // Firefox starts a drag only with some data set.
              event.dataTransfer.setData("application/x-sortable", key);

              if (row) event.dataTransfer.setDragImage(row, 0, 0);

              setDrag({ from: index, over: index });
            }}
            onDragEnd={() => setDrag(null)}
            onKeyDown={(event) => {
              const to =
                event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : undefined;

              if (to === undefined || to < 0 || to >= items.length) return;

              event.preventDefault();
              onMove(index, to);
              setFocusKey(key);
            }}
          >
            <GripVertical className="size-4" />
          </button>
        );

        return (
          <li
            key={key}
            className={cn(
              "rounded-md",
              drag?.from === index && "opacity-50",
              drag && drag.over === index && drag.from !== index && "ring-2 ring-ring",
            )}
            onDragOver={(event) => {
              if (!drag) return;

              event.preventDefault();

              if (drag.over !== index) setDrag({ ...drag, over: index });
            }}
            onDrop={(event) => {
              if (!drag) return;

              event.preventDefault();

              if (drag.from !== index) onMove(drag.from, index);

              setDrag(null);
            }}
          >
            {children(item, index, handle)}
          </li>
        );
      })}
    </ul>
  );
}
