import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { JsxEditorProps } from "@mdxeditor/editor";
import { type z, z as zod } from "astro/zod";

export type { JsxEditorProps };

export type ChildrenConfig = "markdown" | Record<string, ComponentDefinition>;

export interface ComponentDefinition<T extends z.ZodType = z.ZodType> {
  props: T;
  children?: ChildrenConfig;
  kind?: "flow" | "text";
  source?: string;
  defaultExport?: boolean;
  label?: string;
  icon?: LucideIcon;
  editor?: ComponentType<JsxEditorProps>;
}

export interface CmsUserConfig {
  components?: Record<string, ComponentDefinition>;
}

export function defineConfig<const T extends CmsUserConfig>(config: T): T {
  return config;
}

export function defineComponent<T extends z.ZodType>(
  def: ComponentDefinition<T>,
): ComponentDefinition<T> {
  return def;
}

export type ComponentProps<
  Config extends CmsUserConfig,
  Name extends string & keyof NonNullable<Config["components"]>,
> = z.infer<NonNullable<Config["components"]>[Name]["props"]>;

export function image() {
  return zod.string().meta({ "x-cms-image": true });
}

export function file() {
  return zod.string().meta({ "x-cms-file": true });
}
