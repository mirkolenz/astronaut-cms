import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, CircleAlert, Copy, Ellipsis, Plus, Trash2 } from "lucide-react";
import type { ClientComponentDef } from "@/internal/user-config";
import type { BlockActions } from "@/client/lib/block-editing";
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
          <Copy />
          {t(($) => $.entry.duplicate)}
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

/** Adds a structured child, offering only the components allowed there. */
export function AddChildMenu({
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
