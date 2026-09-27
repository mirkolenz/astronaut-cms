/**
 * The one menu that inserts anything into the body: text blocks, components and
 * the clipboard's content. It opens from the buttons between blocks, from
 * typing `/` on an empty line, and from the toolbar.
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Paragraph, RootContent } from "mdast";
import { ClipboardPaste, Plus } from "lucide-react";
import {
  Cell,
  activeEditor$,
  jsxComponentDescriptors$,
  rootEditor$,
  useCellValue,
  usePublisher,
  type Realm,
} from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import type { ComponentIcon } from "@/config";
import { asBlockContent, newComponent } from "@/client/lib/component-tree";
import {
  inlineComponents,
  insertContent,
  insertImage,
  isInlineTarget,
  pasteText,
  readClipboard,
  type InsertTarget,
} from "@/client/lib/editor-content";
import { getBodyRealm } from "@/client/stores/inspector-store";
import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { BLOCK_ICONS, HEADING_ICONS } from "./block-icons";

/** Where the open insert menu inserts, or `null` while it is closed. */
export const insertTarget$ = Cell<InsertTarget | null>(null);

interface InsertItem {
  key: string;
  label: string;
  description?: string | null;
  icon: ComponentIcon | null;
  run: (realm: Realm, target: InsertTarget) => void;
}

const line = (): Paragraph => ({ type: "paragraph", children: [] });

// A block on a line of its own.
const block =
  (...nodes: RootContent[]) =>
  (realm: Realm, target: InsertTarget) =>
    insertContent(realm, target, nodes);

const list = (ordered: boolean): RootContent => ({
  type: "list",
  ordered,
  spread: false,
  children: [{ type: "listItem", spread: false, children: [line()] }],
});

const table = (): RootContent => ({
  type: "table",
  children: Array.from({ length: 3 }, () => ({
    type: "tableRow",
    children: Array.from({ length: 3 }, () => ({ type: "tableCell", children: [] })),
  })),
});

export function InsertButton() {
  const { t } = useTranslation();
  const open = usePublisher(insertTarget$);
  const activeEditor = useCellValue(activeEditor$);
  const rootEditor = useCellValue(rootEditor$);
  const editor = activeEditor ?? rootEditor;

  return (
    <Button type="button" variant="ghost" size="xs" onClick={() => editor && open({ editor })}>
      <Plus />
      {t(($) => $.editors.insert)}
    </Button>
  );
}

export function InsertMenu() {
  const { t } = useTranslation();
  const target = useCellValue(insertTarget$);
  const setTarget = usePublisher(insertTarget$);
  const hasComponents = useCellValue(jsxComponentDescriptors$).length > 0;
  // What was chosen runs once the menu has closed, which would take the focus back otherwise.
  const chosen = useRef<(() => void) | null>(null);
  const inline = target !== null && isInlineTarget(target);

  const textBlock = (key: keyof typeof BLOCK_ICONS, run: InsertItem["run"]): InsertItem => ({
    key,
    label: t(($) => $.editors.blocks[key]),
    icon: BLOCK_ICONS[key],
    run,
  });

  const blocks: InsertItem[] = [
    textBlock("paragraph", block()),
    ...([1, 2, 3] as const).map((depth) => ({
      key: `heading${depth}`,
      label: t(($) => $.editors.blocks.heading, { level: depth }),
      icon: HEADING_ICONS[depth - 1] ?? null,
      run: block({ type: "heading", depth, children: [] }),
    })),
    textBlock("bulletList", block(list(false))),
    textBlock("numberedList", block(list(true))),
    textBlock("quote", block({ type: "blockquote", children: [line()] })),
    textBlock("code", block({ type: "code", lang: null, meta: null, value: "" })),
    textBlock("table", block(table())),
    textBlock("image", insertImage),
    textBlock("divider", block({ type: "thematicBreak" })),
  ];

  const componentItems: InsertItem[] = Object.entries(inline ? inlineComponents : components).map(
    ([name, def]) => ({
      key: `component:${name}`,
      label: def.label,
      description: def.description,
      icon: def.icon,
      run: (realm, target) => {
        const element = newComponent(name, def);

        // An inline component goes where the caret is, within its text.
        insertContent(realm, target, [asBlockContent(element)], { atCaret: element.type === "mdxJsxTextElement" });
      },
    }),
  );

  const paste: InsertItem = {
    key: "paste",
    label: t(($) => $.editors.paste),
    icon: ClipboardPaste,
    run: (realm, target) =>
      void readClipboard().then((text) => text !== undefined && pasteText(realm, target, text)),
  };

  const groups = [
    { heading: t(($) => $.editors.text), items: inline ? [] : blocks },
    { heading: t(($) => $.editors.components), items: hasComponents ? componentItems : [] },
    { heading: t(($) => $.editors.clipboard), items: [paste] },
  ];

  const choose = (item: InsertItem) => {
    const realm = getBodyRealm();

    if (target && realm) chosen.current = () => item.run(realm, target);

    setTarget(null);
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
      <DialogContent
        showCloseButton={false}
        className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
        onCloseAutoFocus={(event) => {
          if (!chosen.current) return;

          event.preventDefault();
          chosen.current();
          chosen.current = null;
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t(($) => $.editors.insert)}</DialogTitle>
          <DialogDescription>{t(($) => $.editors.searchInsert)}</DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder={t(($) => $.editors.searchInsert)} />
          <CommandList>
            <CommandEmpty>{t(($) => $.editors.nothingFound)}</CommandEmpty>
            {groups.map(
              (group) =>
                group.items.length > 0 && (
                  <CommandGroup key={group.heading} heading={group.heading}>
                    {group.items.map((item) => {
                      const Icon = item.icon;

                      return (
                        <CommandItem
                          key={item.key}
                          value={item.key}
                          keywords={[item.label, item.description ?? ""]}
                          onSelect={() => choose(item)}
                        >
                          {Icon && <Icon className="size-4 text-muted-foreground" />}
                          <div className="min-w-0">
                            <div>{item.label}</div>
                            {item.description && (
                              <div className="truncate text-xs text-muted-foreground">{item.description}</div>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ),
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
