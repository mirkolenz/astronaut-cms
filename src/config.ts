import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { JsxEditorProps } from "@mdxeditor/editor";
import type { z } from "zod";
import type { schemaHelpers } from "./shared/cms-markers.ts";

export type { JsxEditorProps };

/**
 * `file()` names an asset in the media library that is bundled as the file
 * itself, for a collection field astro has no helper for. Its `image()`
 * counterpart is deliberately absent: a collection field takes astro's own
 * `({ image })`, and a component prop takes the one its props function is
 * handed, so there is no spelling that resolves in one place and not the other.
 */
export { fileMarker as file, linkMarker as link } from "./shared/cms-markers.ts";

/** The asset and link helpers a component's props function receives. */
export type SchemaHelpers = typeof schemaHelpers;

export type ChildrenConfig = "markdown" | Record<string, ComponentDefinition>;

export interface ComponentDefinition<T extends z.ZodType = z.ZodType> {
  /**
   * The component's props, either as a Zod object or as a function handed the
   * asset helpers, exactly like astro's collection `schema`. Reach for the
   * function form only when a prop names an asset.
   */
  props: T | ((helpers: SchemaHelpers) => T);
  children?: ChildrenConfig;
  kind?: "flow" | "text";
  source?: string;
  defaultExport?: boolean;
  label?: string;
  icon?: LucideIcon;
  editor?: ComponentType<JsxEditorProps>;
}

export function defineComponent<T extends z.ZodType>(
  def: ComponentDefinition<T>,
): ComponentDefinition<T> {
  return def;
}

export type InferComponentProps<Components extends Record<string, ComponentDefinition>> = {
  [Name in string & keyof Components]: Components[Name] extends ComponentDefinition<infer T>
    ? z.infer<T>
    : never;
};
