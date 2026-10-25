import { Fragment, type ComponentProps, type ReactNode } from "react";
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
import { insertChild, pasteChildren, type BlockActions } from "@/client/lib/block-editing";
import { useSidebar } from "@/client/components/ui/sidebar";
import { select, type BlockSelection } from "@/client/stores/inspector-store";
import { SortableList } from "@/client/components/sortable-list";
import { IconButton } from "@/client/components/icon-button";
import { Button } from "@/client/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/client/components/ui/item";
import { Empty, EmptyDescription } from "@/client/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
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
  const docked = !useSidebar().isMobile;

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
          <IconButton label={t(($) => $.common.close)} onClick={() => select(null)}>
            <X />
          </IconButton>
        )}
      </div>

      {children}
    </div>
  );
}

/**
 * What can be done to a block, or an item of a list: moving it, the frequent
 * action, with a button each way greyed out where it cannot go, and the others behind one more.
 */
function BlockActionBar({ actions }: { actions: BlockActions }) {
  const { t } = useTranslation();

  return (
    <>
      {([-1, 1] as const).map((offset) => (
        <IconButton
          key={offset}
          label={offset < 0 ? t(($) => $.editors.moveUp) : t(($) => $.editors.moveDown)}
          disabled={!actions.move[offset]}
          onClick={actions.move[offset]}
        >
          {offset < 0 ? <ArrowUp /> : <ArrowDown />}
        </IconButton>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={t(($) => $.editors.actions)}>
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={actions.duplicate}>
            <CopyPlus />
            {t(($) => $.editors.duplicate)}
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
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0 text-destructive">
          <CircleAlert className="size-4" />
          <span className="sr-only">{message}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}

/** A hint where a list or form has nothing to show yet. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <Empty className="border border-border p-4">
      <EmptyDescription>{children}</EmptyDescription>
    </Empty>
  );
}

interface BlockRow {
  icon?: ComponentIcon | null;
  label: string;
  summary?: string;
  /** How many items it holds, for a list or record. */
  count?: number;
  /** The labels of the required fields without a value. */
  missing?: string[];
  onOpen: () => void;
  /** Whether opening the row shows it in the inspector. */
  inspects?: boolean;
}

/** What opens a block, or a list of items, from a list or a form. */
export function BlockRowButton({
  icon: Icon,
  label,
  summary,
  count,
  missing = [],
  onOpen,
  inspects,
  variant,
}: BlockRow & Pick<ComponentProps<typeof Item>, "variant">) {
  const { t } = useTranslation();

  return (
    <Item asChild size="xs" variant={variant} className="min-w-0 flex-1 text-left hover:bg-muted">
      <button type="button" onClick={onOpen}>
        {Icon && (
          <ItemMedia variant="icon" className="text-muted-foreground">
            <Icon />
          </ItemMedia>
        )}
        <ItemContent className="min-w-0">
          <ItemTitle>{label}</ItemTitle>
          {summary && <ItemDescription className="line-clamp-1">{summary}</ItemDescription>}
        </ItemContent>
        <ItemActions className="gap-1 text-muted-foreground">
          {count !== undefined && (
            <span className="text-xs">{t(($) => $.editors.items, { count })}</span>
          )}
          <MissingProps labels={missing} />
          {inspects && <ChevronRight className="size-4" />}
        </ItemActions>
      </button>
    </Item>
  );
}

/** A list of blocks, each opened by a click and, with `onMove`, reordered by dragging. */
export function BlockList<T>({
  title,
  items,
  getKey,
  onMove,
  row,
  empty,
  children,
}: {
  title?: string;
  items: readonly T[];
  getKey: (item: T) => string;
  onMove?: (from: number, to: number) => void;
  row: (item: T) => BlockRow;
  /** Shown while there are no items. */
  empty?: string;
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
        {(item, _, handle) => (
          <div className="flex items-center gap-1">
            {handle}
            <BlockRowButton {...row(item)} />
          </div>
        )}
      </SortableList>
      {items.length === 0 && empty && <EmptyHint>{empty}</EmptyHint>}
      {children}
    </section>
  );
}
