import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import {
  Cell,
  activeEditor$,
  insertJsx$,
  useCellValue,
  usePublisher,
  type JsxProperties,
} from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import { defaultProps } from "@/client/lib/component-tree";
import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";

/** Whether the component palette is open, so typing `/` can open it as well. */
export const componentPalette$ = Cell(false);

// MDXEditor takes string props as they are and anything else as source text.
function toJsxProperties(props: Record<string, unknown>): JsxProperties {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      typeof value === "string" ? value : { type: "expression", value: JSON.stringify(value) },
    ]),
  );
}

/** The toolbar button and palette that insert a component where the cursor is. */
export function InsertCmsComponent() {
  const { t } = useTranslation();
  const open = useCellValue(componentPalette$);
  const setOpen = usePublisher(componentPalette$);
  const insertJsx = usePublisher(insertJsx$);
  // The text children of an inline component take only inline components.
  const inline = useCellValue(activeEditor$)?.getRootElement()?.closest(".cms-inline-slot") != null;
  const available = Object.entries(components).filter(([, def]) => !inline || def.kind === "text");

  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <Plus />
        {t(($) => $.editors.component)}
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t(($) => $.editors.insertComponent)}
        description={t(($) => $.editors.searchComponents)}
      >
        <Command>
          <CommandInput placeholder={t(($) => $.editors.searchComponents)} />
          <CommandList>
            <CommandEmpty>{t(($) => $.editors.noComponents)}</CommandEmpty>
            {available.map(([name, def]) => {
              const Icon = def.icon;

              return (
                <CommandItem
                  key={name}
                  value={`${def.label} ${name} ${def.description ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    insertJsx({ name, kind: def.kind, props: toJsxProperties(defaultProps(def)) });
                  }}
                >
                  {Icon && <Icon className="size-4 text-muted-foreground" />}
                  <div className="min-w-0">
                    <div>{def.label}</div>
                    {def.description && (
                      <div className="truncate text-xs text-muted-foreground">{def.description}</div>
                    )}
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
