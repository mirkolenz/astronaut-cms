import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  Plus,
  Scissors,
  Trash2,
} from "lucide-react";
import type { ComponentIcon } from "@/config";
import type { ClientComponentDef } from "@/internal/user-config";
import { insertChild, pasteChildren, type BlockActions } from "@/client/lib/block-editing";
import type { BlockSelection } from "@/client/stores/inspector-store";
import { SortableList } from "@/client/components/sortable-list";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/** What can be done to a component block, behind one button. */
export function BlockMenu({ actions }: { actions: BlockActions }) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t(($) => $.editors.actions)}>
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.move(-1)}>
          <ArrowUp />
          {t(($) => $.editors.moveUp)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.move(1)}>
          <ArrowDown />
          {t(($) => $.editors.moveDown)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.duplicate}>
          <CopyPlus />
          {t(($) => $.entry.duplicate)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={actions.copy}>
          <Copy />
          {t(($) => $.editors.copy)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.cut}>
          <Scissors />
          {t(($) => $.editors.cut)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={actions.remove}>
          <Trash2 />
          {t(($) => $.common.delete)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Adds structured children to a block, new or from the clipboard, taking only the components allowed there. */
export function ChildListControls({
  parent,
  childDefs,
}: {
  parent: BlockSelection;
  childDefs: Record<string, ClientComponentDef>;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-1">
      <AddChildMenu childDefs={childDefs} onAdd={(name, def) => insertChild(parent, name, def)} />
      <Button type="button" variant="ghost" size="xs" onClick={() => void pasteChildren(parent, childDefs)}>
        <ClipboardPaste />
        {t(($) => $.editors.paste)}
      </Button>
    </div>
  );
}

function AddChildMenu({
  childDefs,
  onAdd,
}: {
  childDefs: Record<string, ClientComponentDef>;
  onAdd: (name: string, def: ClientComponentDef) => void;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(childDefs);
  const [first] = entries;

  if (!first) return null;

  if (entries.length === 1) {
    const [name, def] = first;

    return (
      <Button type="button" variant="outline" size="xs" onClick={() => onAdd(name, def)}>
        <Plus />
        {t(($) => $.editors.addNamed, { label: def.label })}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="xs">
          <Plus />
          {t(($) => $.editors.addChild)}
        </Button>
      </DropdownMenuTrigger>
      {/* Focus going back to the trigger would select the parent block again. */}
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        {entries.map(([name, def]) => {
          const Icon = def.icon;

          return (
            <DropdownMenuItem key={name} onSelect={() => onAdd(name, def)}>
              {Icon && <Icon />}
              {def.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Flags a block whose required props have no value yet. */
export function MissingProps({ labels }: { labels: string[] }) {
  const { t } = useTranslation();

  if (labels.length === 0) return null;

  const message = t(($) => $.editors.missingProps, { props: labels.join(", ") });

  return (
    <span title={message} className="shrink-0 text-amber-600 dark:text-amber-500">
      <CircleAlert className="size-4" />
      <span className="sr-only">{message}</span>
    </span>
  );
}

interface BlockRow {
  icon?: ComponentIcon | null;
  label: string;
  summary?: string;
  onOpen: () => void;
  /** Shown at the end of the row. */
  trailing?: ReactNode;
}

/** A titled list of blocks, each opened by a click and reordered by dragging. */
export function BlockList<T>({
  title,
  items,
  getKey,
  onMove,
  row,
  children,
}: {
  title: string;
  items: readonly T[];
  getKey: (item: T) => string;
  onMove: (from: number, to: number) => void;
  row: (item: T) => BlockRow;
  /** Shown below the list. */
  children?: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <SortableList items={items} getKey={getKey} onMove={onMove} className="space-y-0.5">
        {(item, _, handle) => {
          const { icon: Icon, label, summary, onOpen, trailing } = row(item);

          return (
            <div className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
              {handle}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                onClick={onOpen}
              >
                {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{label}</span>
                {summary && <span className="truncate text-muted-foreground">{summary}</span>}
                {trailing && <span className="ml-auto flex shrink-0 items-center gap-1">{trailing}</span>}
              </button>
            </div>
          );
        }}
      </SortableList>
      {children}
    </section>
  );
}
