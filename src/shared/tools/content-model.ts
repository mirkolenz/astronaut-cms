/**
 * The content model as something to read rather than something to infer.
 *
 * The in-app assistant is handed it in its system prompt. An agent arriving over
 * WebMCP has no prompt of ours at all, so it gets the same answer from a tool —
 * built here, once, so the two can never describe different sites.
 */
import collections from "virtual:astronaut-cms/collections";
import { extractFormatsFromLoader } from "../types.ts";
import { describeMediaRef } from "../media.ts";
import type { ToolConfig } from "./types.ts";

export interface ContentModel {
  collections: Record<string, { type: string; formats: string[] | null }>;
  /** How an image or file field spells a reference to the media library. */
  mediaReferences: string;
  /** The site's content languages, or null when it is single-language. */
  i18n: { locales: string[]; defaultLocale: string } | null;
}

export function contentModel(config: ToolConfig): ContentModel {
  return {
    collections: Object.fromEntries(
      Object.entries(collections).map(([name, col]) => [
        name,
        {
          type: col.type,
          formats: extractFormatsFromLoader(col.loaderPattern, col.loaderFileName),
        },
      ]),
    ),
    mediaReferences: describeMediaRef(config),
    i18n: config.contentI18n,
  };
}
