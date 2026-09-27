import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { JsxEditorProps } from "@mdxeditor/editor";
import type { z } from "zod";

export type { JsxEditorProps };
export { imageMarker as image, fileMarker as file } from "./shared/cms-markers.ts";

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

export function defineComponent<T extends z.ZodType>(
  def: ComponentDefinition<T>,
): ComponentDefinition<T> {
  return def;
}

export type InferComponentProps<Components extends Record<string, ComponentDefinition>> = {
  [Name in string & keyof Components]: z.infer<Components[Name]["props"]>;
};
