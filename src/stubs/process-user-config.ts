import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { PluggableList } from "unified";
import type { z } from "astro/zod";

interface RawComponentDef {
  props?: z.ZodType;
  children?: "markdown" | Record<string, RawComponentDef>;
  label?: string;
  icon?: LucideIcon;
  wrapper?: ComponentType<{ children: ReactNode }> | null;
}

interface RawUserConfig {
  components?: Record<string, RawComponentDef>;
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
}

interface ProcessedComponentDef {
  props: z.ZodType | null;
  children?: "markdown" | Record<string, ProcessedComponentDef>;
  label: string;
  icon: LucideIcon | null;
  wrapper: ComponentType<{ children: ReactNode }> | null;
}

export function processUserConfig(config: RawUserConfig | null) {
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
        label: def.label ?? name,
        icon: def.icon ?? null,
        wrapper: def.wrapper ?? null,
      };
    }
    return result;
  }

  return {
    components: transform(config?.components ?? {}),
    remarkPlugins: config?.remarkPlugins ?? [],
    rehypePlugins: config?.rehypePlugins ?? [],
  };
}
