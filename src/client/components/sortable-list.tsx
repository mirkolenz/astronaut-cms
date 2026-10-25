import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical } from "lucide-react";
import { cn } from "cn";
import { IconButton } from "@/client/components/icon-button";

interface SortableListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  /** Left out for a list in a fixed order, whose items have no handle. */
  onMove?: (from: number, to: number) => void;
  /** Keeps the handles in place but inactive, such as while a move is saved. */
  disabled?: boolean;
  /** Renders an item, with its drag `handle` placed wherever it belongs. */
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
  className?: string;
}

/** A list reordered by dragging an item's handle, or with the arrow keys while it has focus. */
export function SortableList<T>({
  items,
  getKey,
  onMove,
  disabled = false,
  children,
  className,
}: SortableListProps<T>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const moved = useRef<{ key: string; to: number } | null>(null);

  // A moved item's handle can lose focus when its element is reinserted,
  // so it is focused again once the move shows, which a saved move delays.
  useLayoutEffect(() => {
    const pending = moved.current;

    if (!pending || items.findIndex((item, i) => getKey(item, i) === pending.key) !== pending.to)
      return;

    moved.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-sortable-key="${CSS.escape(pending.key)}"]`)
      ?.focus();
  });

  return (
    <ul ref={listRef} className={className}>
      {items.map((item, index) => {
        const key = getKey(item, index);
        const handle = onMove && (
          <IconButton
            label={t(($) => $.editors.reorder)}
            draggable={!disabled}
            aria-disabled={disabled}
            data-sortable-key={key}
            className={cn(
              "shrink-0 text-muted-foreground",
              disabled ? "opacity-50" : "cursor-grab active:cursor-grabbing",
            )}
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
                event.key === "ArrowUp"
                  ? index - 1
                  : event.key === "ArrowDown"
                    ? index + 1
                    : undefined;

              if (disabled || to === undefined || to < 0 || to >= items.length) return;

              event.preventDefault();
              onMove(index, to);
              moved.current = { key, to };
            }}
          >
            <GripVertical />
          </IconButton>
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

              if (drag.from !== index) onMove?.(drag.from, index);

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
