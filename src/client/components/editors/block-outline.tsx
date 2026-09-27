/**
 * The top-level blocks of the body, to reorder by dragging and to jump to. The
 * inspector shows it while no component is selected.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ListChecks, Puzzle, Square } from "lucide-react";
import {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { components } from "virtual:astronaut-cms/user-config";
import type { ComponentIcon } from "@/config";
import { findComponent } from "@/shared/component-lookup";
import { labelOf, summaryOf } from "@/client/lib/component-tree";
import { isJsxNode, useEditorValue } from "@/client/lib/block-editing";
import { $isEmptyLine } from "@/client/lib/empty-lines";
import { select } from "@/client/stores/inspector-store";
import { BlockList } from "@/client/components/editors/block-controls";
import { BLOCK_ICONS, HEADING_ICONS } from "@/client/components/editors/block-icons";

interface OutlineItem {
  key: string;
  icon: ComponentIcon;
  label: string;
  /** A component's summary, next to its label. */
  summary?: string;
  isComponent: boolean;
}

function $describe(node: LexicalNode, t: TFunction): OutlineItem {
  const key = node.getKey();

  if (isJsxNode(node)) {
    const element = node.getMdastNode();
    const def = element.name ? findComponent(element.name, components) : undefined;

    return {
      key,
      icon: def?.icon ?? Puzzle,
      label: labelOf(def, element),
      summary: summaryOf(def, element),
      isComponent: true,
    };
  }

  // A text block shows its first line, or what kind of block it is.
  const block = (icon: ComponentIcon, name: string): OutlineItem => ({
    key,
    icon,
    label: node.getTextContent().trim().split("\n")[0] || name,
    isComponent: false,
  });
  // MDXEditor's node classes are its own, so a block is known by its serialized form.
  const json: { type: string; tag?: string; listType?: string } = node.exportJSON();

  switch (json.type) {
    case "paragraph":
      return block(BLOCK_ICONS.paragraph, t(($) => $.editors.blocks.paragraph));
    case "heading": {
      const level = Number(json.tag?.slice(1) ?? 1);

      return block(HEADING_ICONS[level - 1] ?? Square, t(($) => $.editors.blocks.heading, { level }));
    }
    case "list":
      return json.listType === "number"
        ? block(BLOCK_ICONS.numberedList, t(($) => $.editors.blocks.numberedList))
        : block(json.listType === "check" ? ListChecks : BLOCK_ICONS.bulletList, t(($) => $.editors.blocks.bulletList));
    case "quote":
      return block(BLOCK_ICONS.quote, t(($) => $.editors.blocks.quote));
    case "codeblock":
      return block(BLOCK_ICONS.code, t(($) => $.editors.blocks.code));
    case "table":
      return block(BLOCK_ICONS.table, t(($) => $.editors.blocks.table));
    case "horizontalrule":
      return block(BLOCK_ICONS.divider, t(($) => $.editors.blocks.divider));
    default:
      return block(Square, node.getType());
  }
}

function moveBlock(editor: LexicalEditor, key: string, target: string, after: boolean): void {
  editor.update(
    () => {
      const node = $getNodeByKey(key);
      const anchor = $getNodeByKey(target);

      if (!node || !anchor) return;

      if (after) anchor.insertAfter(node);
      else anchor.insertBefore(node);
    },
    { tag: [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] },
  );
}

export function BlockOutline({ editor }: { editor: LexicalEditor }) {
  const { t } = useTranslation();
  const state = useEditorValue(editor, () => editor.getEditorState());
  const items = useMemo(
    () =>
      state.read(() =>
        $getRoot()
          .getChildren()
          .filter((node) => !$isEmptyLine(node))
          .map((node) => $describe(node, t)),
      ),
    [state, t],
  );

  const open = ({ key, isComponent }: OutlineItem) => {
    if (isComponent) {
      select({ editor, nodeKey: key, path: [], trail: [] }, { reveal: true });

      return;
    }

    editor.getElementByKey(key)?.scrollIntoView({ block: "nearest" });

    // The caret goes to the start of a text block.
    if (!editor.getEditorState().read(() => $isElementNode($getNodeByKey(key)))) return;

    editor.update(() => $getNodeByKey(key)?.selectStart());
    editor.focus();
  };

  return (
    <BlockList
      title={t(($) => $.editors.outline)}
      items={items}
      getKey={(item) => item.key}
      onMove={(from, to) => {
        const [item, target] = [items[from], items[to]];

        if (item && target) moveBlock(editor, item.key, target.key, to > from);
      }}
      row={(item) => ({ ...item, onOpen: () => open(item), inspects: item.isComponent })}
    >
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t(($) => $.editors.outlineEmpty)}</p>}
    </BlockList>
  );
}
