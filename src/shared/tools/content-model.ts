/**
 * The content model as something to read rather than something to infer.
 *
 * The in-app assistant is handed it in its system prompt. An agent arriving over
 * WebMCP has no prompt of ours at all, so it gets the same answer from a tool —
 * built here, once, so the two can never describe different sites.
 */
import { extractFormatsFromLoader, singletonEntry } from "../types.ts";
import { describeMediaRef } from "../media.ts";
import { componentOverview, type ComponentOverview } from "./components.ts";
import type { ToolConfig } from "./types.ts";

export interface ContentModel {
  /**
   * `reorderable` marks a collection sorted by file order, the only one
   * reorderEntries changes. `singleton` names the only entry of a collection
   * that can neither gain, lose nor rename one.
   */
  collections: Record<
    string,
    {
      type: string;
      formats: string[] | null;
      reorderable: boolean;
      singleton: string | null;
    }
  >;
  /** How an image or file field spells a reference to the media library. */
  mediaReferences: string;
  /** The site's content languages, or null when it is single-language. */
  i18n: { locales: string[]; defaultLocale: string } | null;
  /** The components an MDX body may use, a child set nested under the one parent that takes it. */
  components: Record<string, ComponentOverview>;
}

export function contentModel(config: ToolConfig): ContentModel {
  return {
    collections: Object.fromEntries(
      Object.entries(config.collections).map(([name, col]) => [
        name,
        {
          type: col.type,
          formats: extractFormatsFromLoader(col.loaderPattern, col.loaderFileName),
          reorderable: col.sort === "file",
          singleton: singletonEntry(col)?.id ?? null,
        },
      ]),
    ),
    mediaReferences: describeMediaRef(config.media),
    i18n: config.contentI18n,
    components: componentOverview(config.components),
  };
}
