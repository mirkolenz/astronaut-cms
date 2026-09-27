/**
 * The insert buttons between blocks. Pointing at a block, or tapping it, shows
 * one on the line above it and one below, each opening the insert menu for
 * that spot. They work the same for text and components, in the body and in
 * the markdown content of a component.
 */
import { useEffect, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { $getNearestNodeFromDOMNode, getNearestEditorFromDOMNode, type LexicalEditor } from "lexical";
import { contentEditableRef$, useCellValue, usePublisher } from "@mdxeditor/editor";
import { isInlineRoot } from "@/client/lib/editor-content";
import { insertTarget$ } from "./insert-menu";

interface HoveredBlock {
  editor: LexicalEditor;
  nodeKey: string;
  element: HTMLElement;
}

const EDITOR_ROOT = "[data-lexical-editor]";

// The top-level block element around a node, in the innermost editor that holds blocks.
function blockElementAt(node: Element): HTMLElement | null {
  let root = node.closest(EDITOR_ROOT);

  while (root && isInlineRoot(root)) root = root.parentElement?.closest(EDITOR_ROOT) ?? null;

  let element: Element | null = node;

  while (element && element.parentElement !== root) element = element.parentElement;

  return root && element instanceof HTMLElement ? element : null;
}

function hoveredBlock(element: HTMLElement): HoveredBlock | null {
  const editor = element.parentElement && getNearestEditorFromDOMNode(element.parentElement);
  const nodeKey = editor?.getEditorState().read(() => $getNearestNodeFromDOMNode(element)?.getKey(), { editor });

  return editor && nodeKey ? { editor, nodeKey, element } : null;
}

export function GapInserter() {
  const { t } = useTranslation();
  const wrapper = useCellValue(contentEditableRef$)?.current;
  const openMenu = usePublisher(insertTarget$);
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const [, relayout] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!wrapper) return;

    const controller = new AbortController();
    const move = (event: PointerEvent) => {
      const target = event.target;

      // Between blocks, and on the way to a button, the block stays.
      if (!(target instanceof Element) || target.matches(EDITOR_ROOT) || target.closest("[data-gap-inserter]")) {
        return;
      }

      const element = blockElementAt(target);

      setHovered((current) => (current?.element === element ? current : element && hoveredBlock(element)));
    };

    // A tap points at a block as well.
    wrapper.addEventListener("pointermove", move, { signal: controller.signal });
    wrapper.addEventListener("pointerdown", move, { signal: controller.signal });
    // A touch leaves once lifted, and its block stays until the next one.
    wrapper.addEventListener(
      "pointerleave",
      (event) => {
        if (event.pointerType !== "touch") setHovered(null);
      },
      { signal: controller.signal },
    );

    return () => controller.abort();
  }, [wrapper]);

  // The buttons follow the block as the content around it changes.
  useEffect(() => {
    if (!wrapper || !hovered) return;

    const observer = new ResizeObserver(relayout);

    observer.observe(wrapper);
    observer.observe(hovered.element);

    return () => observer.disconnect();
  }, [wrapper, hovered]);

  if (!wrapper || !hovered?.element.isConnected) return null;

  const { editor, nodeKey, element } = hovered;
  const base = wrapper.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const previous = element.previousElementSibling?.getBoundingClientRect();
  const next = element.nextElementSibling?.getBoundingClientRect();
  // Each button sits halfway to the neighboring block, and within the editor at either end.
  const first = Math.max(rect.top - 6, base.top + 10);
  const last = Math.min(rect.bottom + 6, base.bottom - 10);
  const gaps = [
    { position: "before" as const, y: previous ? (previous.bottom + rect.top) / 2 : first },
    { position: "after" as const, y: next ? (rect.bottom + next.top) / 2 : last },
  ];

  return createPortal(
    <div data-gap-inserter>
      {gaps.map(({ position, y }) => (
        <div
          key={position}
          className="group/gap pointer-events-none absolute z-10 flex h-4 -translate-y-1/2 items-center justify-center"
          style={{ top: y - base.top, left: rect.left - base.left, width: rect.width }}
        >
          <div className="absolute inset-x-0 top-1/2 h-px bg-primary opacity-0 transition-opacity group-hover/gap:opacity-60" />
          <button
            type="button"
            aria-label={t(($) => (position === "before" ? $.editors.insertAbove : $.editors.insertBelow))}
            className="pointer-events-auto relative flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:border-primary hover:text-primary"
            // The editor keeps its focus and selection until the menu opens.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openMenu({ editor, at: { nodeKey, position } })}
          >
            <Plus className="size-3" />
          </button>
        </div>
      ))}
    </div>,
    wrapper,
  );
}
