import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  Plus,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import type { ComponentIcon } from "@/config";
import type { ClientComponentDef } from "@/internal/user-config";
import {
  insertChild,
  pasteChildren,
  type BlockActions,
  type Moves,
} from "@/client/lib/block-editing";
import { useMediaQuery } from "@/client/lib/use-media-query";
import { select, type BlockSelection } from "@/client/stores/inspector-store";
import { SortableList } from "@/client/components/sortable-list";
import { Button } from "@/client/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/client/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

// Wide enough for the content and the docked inspector side by side.
export const DOCKED = "(min-width: 80rem)";

/** A step on the way back out of what the inspector shows. */
export interface InspectorCrumb {
  label: string;
  onSelect: () => void;
}

/**
 * The frame of what the inspector shows, a component or a value of a form: the
 * breadcrumbs leading back out, and a header with its actions, the one place
 * they are offered in.
 */
export function InspectorView({
  crumbs,
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  crumbs: readonly InspectorCrumb[];
  icon?: ComponentIcon | null;
  title: string;
  description?: string | null;
  actions?: BlockActions;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // Docked, the inspector stays. As a sheet over the content, it closes.
  const docked = useMediaQuery(DOCKED);

  return (
    <div className="space-y-4">
      {crumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            {crumbs.map((crumb, index) => (
              <Fragment key={index}>
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbLink asChild>
                    <button type="button" className="max-w-40 truncate" onClick={crumb.onSelect}>
                      {crumb.label}
                    </button>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment>
            ))}
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="flex items-start gap-2">
        {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <BlockActionBar actions={actions} />}
        {!docked && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t(($) => $.common.close)}
            onClick={() => select(null)}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {children}
    </div>
  );
}

/** Buttons moving something one place up and down, each greyed out where it cannot go. */
export function MoveButtons({ moves }: { moves: Moves }) {
  const { t } = useTranslation();

  return ([-1, 1] as const).map((offset) => (
    <Button
      key={offset}
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={offset < 0 ? t(($) => $.editors.moveUp) : t(($) => $.editors.moveDown)}
      disabled={!moves[offset]}
      onClick={moves[offset]}
    >
      {offset < 0 ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
    </Button>
  ));
}

/**
 * What can be done to a block, or an item of a list: moving it, the frequent
 * action, with a button each way, and the others behind one more.
 */
function BlockActionBar({ actions }: { actions: BlockActions }) {
  const { t } = useTranslation();

  return (
    <>
      <MoveButtons moves={actions.move} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t(($) => $.editors.actions)}
          >
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={actions.duplicate}>
            <CopyPlus />
            {t(($) => $.entry.duplicate)}
          </DropdownMenuItem>
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
    </>
  );
}

/** The controls below a list: the way to add an item, and pasting items from the clipboard. */
export function ListControls({ onPaste, children }: { onPaste: () => void; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-1">
      {children}
      <Button type="button" variant="ghost" size="xs" onClick={onPaste}>
        <ClipboardPaste />
        {t(($) => $.editors.paste)}
      </Button>
    </div>
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
  return (
    <ListControls onPaste={() => void pasteChildren(parent, childDefs)}>
      <AddMenu
        options={Object.entries(childDefs).map(([name, def]) => ({
          key: name,
          label: def.label,
          icon: def.icon,
        }))}
        onAdd={(name) => {
          const def = childDefs[name];

          if (def) insertChild(parent, name, def);
        }}
      />
    </ListControls>
  );
}

/** A kind of item a list takes, such as a component or a variant of a union. */
export interface AddOption {
  key: string;
  /** Left out for the one kind of a list that takes plain items. */
  label?: string;
  icon?: ComponentIcon | null;
}

/** Adds an item to a list, of the one kind it takes or of one chosen from a menu. */
export function AddMenu({
  options,
  onAdd,
}: {
  options: readonly AddOption[];
  onAdd: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [first] = options;

  if (!first) return null;

  if (options.length === 1) {
    const { key, label } = first;

    return (
      <Button type="button" variant="outline" size="xs" onClick={() => onAdd(key)}>
        <Plus />
        {label === undefined
          ? t(($) => $.editors.addItem)
          : t(($) => $.editors.addNamed, { label })}
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
        {options.map(({ key, label, icon: Icon }) => (
          <DropdownMenuItem key={key} onSelect={() => onAdd(key)}>
            {Icon && <Icon />}
            {label ?? key}
          </DropdownMenuItem>
        ))}
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
  /** The labels of the required fields without a value. */
  missing?: string[];
  onOpen: () => void;
  /** Whether opening the row shows it in the inspector. */
  inspects?: boolean;
}

/** A list of blocks, each opened by a click and reordered by dragging. */
export function BlockList<T>({
  title,
  items,
  getKey,
  onMove,
  row,
  children,
}: {
  title?: string;
  items: readonly T[];
  getKey: (item: T) => string;
  onMove: (from: number, to: number) => void;
  row: (item: T) => BlockRow;
  /** Shown below the list. */
  children?: ReactNode;
}) {
  return (
    <section className="space-y-2">
      {title && (
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
      )}
      <SortableList items={items} getKey={getKey} onMove={onMove} className="space-y-0.5">
        {(item, _, handle) => {
          const { icon: Icon, label, summary, missing = [], onOpen, inspects } = row(item);

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
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <MissingProps labels={missing} />
                  {inspects && <ChevronRight className="size-4 text-muted-foreground" />}
                </span>
              </button>
            </div>
          );
        }}
      </SortableList>
      {children}
    </section>
  );
}
