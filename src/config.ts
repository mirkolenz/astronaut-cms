import type { ReactNode } from "react";
import type { JsxEditor, JsxEditorProps } from "./shared/jsx-editor.ts";
import type { z } from "zod";
import type { schemaHelpers } from "./shared/cms-markers.ts";
import type { CollectionSort } from "./shared/types.ts";

export type { JsxEditor, JsxEditorProps };

/** An icon for the admin, such as one of `lucide-react`'s. */
export type ComponentIcon = (props: { className?: string }) => ReactNode;

/**
 * `file()` names an asset in either media library that is bundled as the file
 * itself, for a collection field astro has no helper for. Its `image()`
 * counterpart is deliberately absent: a collection field takes astro's own
 * `({ image })`, wrapped in `libraryImage(image)` to take object-store files
 * too, and a component prop takes the one its props function is handed, so
 * there is no spelling that resolves in one place and not the other.
 */
export {
  anchorMarker as anchor,
  fileMarker as file,
  libraryImage,
  linkMarker as link,
} from "./shared/cms-markers.ts";

/**
 * Filled in for each site by the types the integration generates, with the
 * collection names of its content config. Empty where those types are not loaded.
 */
export interface CollectionRegistry {}

/** A collection of the content config, or any string before `astro sync` names them. */
export type CollectionName = CollectionRegistry extends { name: infer N extends string }
  ? N
  : string;

/** The asset, link, anchor and reference helpers a component's props function receives. */
export type SchemaHelpers = Omit<typeof schemaHelpers, "reference"> & {
  reference: (collection: CollectionName) => ReturnType<typeof schemaHelpers.reference>;
};

export type ChildrenConfig = "markdown" | Record<string, ComponentDefinition>;

export interface ComponentDefinition<
  T extends z.ZodType<object> = z.ZodType<object>,
  C extends ChildrenConfig = ChildrenConfig,
> {
  /**
   * The component's props, either as a Zod object or as a function handed the
   * schema helpers, exactly like astro's collection `schema`. Reach for the
   * function form only when a prop names an asset, a link, an anchor or an entry.
   */
  props: T | ((helpers: SchemaHelpers) => T);
  /**
   * The `.astro` component that renders it, imported as the site imports it,
   * such as `"@/components/Hero.astro"`, or relative to `cms.config`.
   * Every MDX body can use it by name, with the schema's defaults applied.
   */
  component: string;
  children?: C;
  kind?: "flow" | "text";
  label?: string;
  /** What the component is for, shown when inserting and editing it. */
  description?: string;
  /**
   * The collections whose entries the component renders, such as `["projects"]`.
   * Selecting it in the admin links to them, since that is where its content is edited.
   */
  collections?: CollectionName[];
  /**
   * The prop that names an instance in the admin, such as `"title"`. Defaults to
   * the first required text prop with a value, then to any text prop with one.
   */
  summary?: string;
  icon?: ComponentIcon;
  editor?: JsxEditor;
}

export type { CollectionSort };

/** What `cms.config` adds to one collection of the content config. */
export interface CollectionOptions {
  /**
   * How entries are ordered, both in the admin and for the site through
   * `sortEntries` from `astronaut-cms/content` (default: "id", astro's own
   * order). "file" keeps the order of a `file()` collection's file, which
   * editors can then change.
   */
  sort?: CollectionSort;
  /** What the admin calls the collection (default: its name, title-cased). */
  label?: string;
  /** What the collection is for, shown in the admin and told to agents. */
  description?: string;
  icon?: ComponentIcon;
}

/**
 * One entry of the `collections` export of `cms.config`, keyed like the
 * collections of `content.config`, as {@link defineComponent} is one entry of
 * `components`.
 */
export function defineCollection(options: CollectionOptions): CollectionOptions {
  return options;
}

/**
 * One entry of the `components` export of `cms.config`. The integration renders
 * it in MDX through a generated wrapper, which `astronaut-cms:components` exports.
 */
export function defineComponent<T extends z.ZodType<object>, C extends ChildrenConfig = never>(
  def: ComponentDefinition<T, C>,
): ComponentDefinition<T, C> {
  return def;
}
