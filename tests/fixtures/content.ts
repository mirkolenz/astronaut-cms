import type { ContentI18n } from "@/shared/i18n";
import type { CollectionSort } from "@/shared/types";

// Stand-in for the build-time `virtual:astronaut-cms/content` module.
export const sorts: Record<string, CollectionSort> = { events: "file", pages: "natural" };
export const fileOrder: Record<string, string[]> = { events: ["b", "c", "a"] };
export const contentI18n: ContentI18n | null = { locales: ["de", "en"], defaultLocale: "de" };
