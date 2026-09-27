import { usePublisher, insertJsx$ } from "@mdxeditor/editor";
import type { ClientComponentDef } from "@/internal/user-config";
import { components } from "virtual:astronaut-cms/user-config";
import { objectShape } from "@/shared/field-schema";
import { getDefaultValue } from "./field-renderer";
import { Plus } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/**
 * Builds default JSX props from a Zod schema for inserting a new component.
 */
function buildDefaultProps(def: ClientComponentDef): Record<string, string> {
  const shape = objectShape(def.props);
  if (!shape) return {};
  const props: Record<string, string> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const val = getDefaultValue(fieldSchema);
    if (val === undefined || val === null) continue;
    if (typeof val === "string") {
      props[key] = val;
    } else {
      props[key] = JSON.stringify(val);
    }
  }
  return props;
}

/**
 * Toolbar button for inserting CMS component blocks into the MDX editor.
 */
export function InsertCmsComponent() {
  const insertJsx = usePublisher(insertJsx$);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          <Plus />
          Component
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {Object.entries(components).map(([name, def]) => {
          const Icon = def.icon;
          return (
            <DropdownMenuItem
              key={name}
              onSelect={() => {
                const props = buildDefaultProps(def);
                insertJsx({
                  name,
                  kind: def.kind,
                  props,
                });
              }}
            >
              {Icon && <Icon className="mr-2 size-4" />}
              {def.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
