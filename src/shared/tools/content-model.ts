/**
 * The content model as something to read rather than something to infer.
 *
 * The in-app assistant is handed it in its system prompt. An agent arriving over
 * WebMCP has no prompt of ours at all, so it gets the same answer from a tool,
 * built here, once, so the two can never describe different sites.
 */
import { extractFormatsFromLoader, singletonIds } from "@/shared/types";
import { describeMediaRef } from "@/shared/media";
import { collectionLabel } from "@/shared/labels";
import { componentOverview, type ComponentOverview } from "@/shared/tools/components";
import type { ToolConfig } from "@/shared/tools/types";

export interface ContentModel {
  /**
   * `reorderable` marks a collection sorted by file order, the only one
   * reorderEntries changes. `singleton` names the entries of a collection that
   * can neither gain nor rename one: its only entry, or one per language for a
   * localized singleton, the default language's first, which cannot be deleted.
   * It is empty for any other collection.
   */
  collections: Record<
    string,
    {
      label: string;
      description: string | null;
      type: string;
      formats: string[] | null;
      reorderable: boolean;
      singleton: string[];
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
          label: collectionLabel(col),
          description: col.description ?? null,
          type: col.type,
          formats: extractFormatsFromLoader(col.loaderPattern, col.loaderFileName),
          reorderable: col.sort === "file",
          singleton: singletonIds(col),
        },
      ]),
    ),
    mediaReferences: describeMediaRef(config.media),
    i18n: config.contentI18n,
    components: componentOverview(config.components),
  };
}
