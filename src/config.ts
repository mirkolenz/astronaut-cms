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

/** The asset, link and reference helpers a component's props function receives. */
export type SchemaHelpers = typeof schemaHelpers;

export type ChildrenConfig = "markdown" | Record<string, ComponentDefinition>;

export interface ComponentDefinition<
  T extends z.ZodType = z.ZodType,
  C extends ChildrenConfig = ChildrenConfig,
> {
  /**
   * The component's props, either as a Zod object or as a function handed the
   * schema helpers, exactly like astro's collection `schema`. Reach for the
   * function form only when a prop names an asset, a link or an entry.
   */
  props: T | ((helpers: SchemaHelpers) => T);
  children?: C;
  kind?: "flow" | "text";
  source?: string;
  defaultExport?: boolean;
  label?: string;
  icon?: LucideIcon;
  editor?: ComponentType<JsxEditorProps>;
}

export function defineComponent<T extends z.ZodType, C extends ChildrenConfig = never>(
  def: ComponentDefinition<T, C>,
): ComponentDefinition<T, C> {
  return def;
}

// `unknown` for no members, since the intersection of nothing constrains nothing.
type UnionToIntersection<U> = [U] extends [never]
  ? unknown
  : (U extends unknown ? (union: U) => void : never) extends (intersection: infer I) => void
    ? I
    : never;

// The props of one definition's child components, or `never` for a leaf or
// markdown children, which drops out of the union rather than absorbing it.
type ChildProps<Definition> =
  Definition extends ComponentDefinition<z.ZodType, infer C>
    ? [C] extends [never]
      ? never
      : [C] extends [Record<string, ComponentDefinition>]
        ? InferComponentProps<C>
        : never
    : never;

/**
 * The props of every component, the children of each included, as the MDX
 * body writes them. That is the schema's input: MDX hands a component its
 * attributes verbatim, so a `.default()` never applies and the prop is optional.
 */
export type InferComponentProps<Components extends Record<string, ComponentDefinition>> = {
  [Name in string & keyof Components]: Components[Name] extends ComponentDefinition<infer T>
    ? z.input<T>
    : never;
} & UnionToIntersection<{ [Name in keyof Components]: ChildProps<Components[Name]> }[keyof Components]>;
