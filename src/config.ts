import type { ComponentType, ReactNode } from "react";
import type { PluggableList } from "unified";
import { type z, z as zod } from "zod/v4";

export type ChildrenConfig = "markdown" | Record<string, ComponentDefinition>;

export interface ComponentDefinition<T extends z.ZodType = z.ZodType> {
  props: T;
  children?: ChildrenConfig;
  label?: string;
  icon?: string;
  wrapper?: ComponentType<{ children: ReactNode }>;
}

export interface CmsUserConfig {
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
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
