import { useTranslation } from "react-i18next";
import { Type } from "lucide-react";
import type { ClientComponentDef } from "virtual:astronaut-cms/user-config";
import type { Block } from "@/client/lib/block-model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

interface AddBlockButtonProps {
  onAdd: (block: Block) => void;
  availableComponents: Record<string, ClientComponentDef>;
  showTextOption?: boolean;
}

export function AddBlockButton({
  onAdd,
  availableComponents,
  showTextOption = true,
}: AddBlockButtonProps) {
  const { t } = useTranslation();
  const entries = Object.entries(availableComponents);

  return (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-full border border-dashed border-gray-300 px-3 py-0.5 text-xs text-gray-400 transition-colors hover:border-blue-400 hover:text-blue-500 dark:border-gray-600 dark:hover:border-blue-500"
          >
            {t($ => $.editors.addBlock)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[160px]">
          {showTextOption && (
            <DropdownMenuItem
              onSelect={() => {
                onAdd({
                  id: crypto.randomUUID(),
                  type: "text",
                  content: "",
                });
              }}
            >
              <Type className="size-3.5 text-muted-foreground" />
              {t($ => $.editors.text)}
            </DropdownMenuItem>
          )}
          {entries.map(([name, def]) => {
            const DefIcon = def.icon;
            return (
              <DropdownMenuItem
                key={name}
                onSelect={() => {
                  onAdd({
                    id: crypto.randomUUID(),
                    type: "component",
                    name,
                    props: {},
                    children: [],
                  });
                }}
              >
                {DefIcon && <DefIcon className="size-3.5" />}
                {def.label}
              </DropdownMenuItem>
            );
          })}
          {!showTextOption && entries.length === 0 && (
            <span className="block px-3 py-1.5 text-xs text-muted-foreground">{t($ => $.editors.noComponents)}</span>
          )}
        </DropdownMenuContent>
    </DropdownMenu>
  );
}
