import { useMemo } from "react";
import type { EntryMeta } from "@/shared/types";
import { type ContentI18n, isLocalized, joinLocale, localeOf, splitLocale } from "@/shared/i18n";
import config from "@/client/lib/config";

export interface CollectionI18n extends ContentI18n {
  /** Every entry id, prepared once so translations can be paired per row. */
  ids: ReadonlySet<string>;
}

/**
 * The locale set to edit a collection with, or null when it is not organized by
 * locale. Derived from the entries themselves (see {@link isLocalized}), so a
 * localized and a plain collection can sit side by side without any per-collection
 * configuration.
 */
export function useCollectionI18n(entries: EntryMeta[] | undefined): CollectionI18n | null {
  return useMemo(() => {
    if (!config.contentI18n || !entries) return null;

    const ids = new Set(entries.map((e) => e.id));

    return isLocalized(ids, config.contentI18n.locales) ? { ...config.contentI18n, ids } : null;
  }, [entries]);
}

export interface BrowseLocation {
  /** Locale being browsed, or null when the collection is not localized. */
  activeLocale: string | null;
  /** Folder below the locale. */
  subDir: string;
  /** Folder to list, locale included. */
  browseDir: string;
}

/**
 * Decodes a collection's `dir` search param, which carries the locale as its
 * first segment — the language is simply the outermost folder, so folder links,
 * breadcrumbs and the browsed path stay one value. An empty `dir` means the root
 * of the default locale. Shared by the listing and the breadcrumb trail so both
 * read the param the same way.
 */
export function browseLocation(i18n: ContentI18n | null, dir: string): BrowseLocation {
  const { locale, slug } = splitLocale(dir, i18n?.locales ?? []);
  const activeLocale = i18n ? (locale ?? i18n.defaultLocale) : null;

  return {
    activeLocale,
    subDir: slug,
    browseDir: activeLocale ? joinLocale(activeLocale, slug) : dir,
  };
}

/** How many entries a locale holds, across all of its subfolders. */
export const countIn = (i18n: CollectionI18n, locale: string): number =>
  i18n.ids.values().filter((id) => localeOf(id, i18n.locales) === locale).reduce((count) => count + 1, 0);
