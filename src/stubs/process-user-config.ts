import type { ComponentType } from "react";
import type { JsxEditorProps } from "@mdxeditor/editor";
import type { LucideIcon } from "lucide-react";
import type { z } from "astro/zod";

interface RawComponentDef {
  props?: z.ZodType;
  children?: "markdown" | Record<string, RawComponentDef>;
  kind?: "flow" | "text";
  source?: string;
  defaultExport?: boolean;
  label?: string;
  icon?: LucideIcon;
  editor?: ComponentType<JsxEditorProps>;
}

interface ProcessedComponentDef {
  props: z.ZodType | null;
  children?: "markdown" | Record<string, ProcessedComponentDef>;
  kind: "flow" | "text";
  source: string | null;
  defaultExport: boolean;
  label: string;
  icon: LucideIcon | null;
  editor: ComponentType<JsxEditorProps> | null;
}

export function processUserConfig(
  components: Record<string, RawComponentDef> | undefined,
): Record<string, ProcessedComponentDef> {
  function transform(defs: Record<string, RawComponentDef>): Record<string, ProcessedComponentDef> {
    const result: Record<string, ProcessedComponentDef> = {};
    for (const [name, def] of Object.entries(defs)) {
      let children: ProcessedComponentDef["children"];
      if (def.children === "markdown") {
        children = "markdown";
      } else if (typeof def.children === "object" && def.children !== null) {
        children = transform(def.children);
      }
      result[name] = {
        props: def.props ?? null,
        children,
        kind: def.kind ?? "flow",
        source: def.source ?? null,
        defaultExport: def.defaultExport ?? false,
        label: def.label ?? name,
        icon: def.icon ?? null,
        editor: def.editor ?? null,
      };
    }
    return result;
  }

  return transform(components ?? {});
}
