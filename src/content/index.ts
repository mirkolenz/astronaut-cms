/**
 * Reading content in the site the way the admin edits it: entry order, and the
 * language of localized collections and fields.
 *
 * Entry order is the same the admin shows. Astro's content store
 * returns a collection sorted by id and keeps no trace of the order a `file()`
 * collection's file holds, so a collection with a `sort` option is ordered here,
 * from what the integration read off the content.
 */
import { type CollectionEntry, type CollectionKey, getEntry } from "astro:content";
import { contentI18n, fileOrder, sorts } from "virtual:astronaut-cms/content";
import { type ContentI18n, joinLocale, splitLocale } from "../shared/i18n.ts";
import { compareIds, sortByIds } from "../shared/types.ts";

// Each file position by id, built once per module instance.
const ranks = new Map(
  Object.entries(fileOrder).map(([name, ids]) => [
    name,
    new Map(ids.map((id, index) => [id, index])),
  ]),
);

/** What ordering reads off an entry of astro's `getCollection`. */
interface SortableEntry {
  id: string;
  collection: string;
}

/**
 * The entries of one collection, in the order its `sort` option names.
 *
 * @example
 * const events = sortEntries(await getCollection("events"));
 */
export function sortEntries<E extends SortableEntry>(entries: readonly E[]): E[] {
  const collection = entries[0]?.collection ?? "";
  const sort = sorts[collection] ?? "id";
  const rank = ranks.get(collection);

  if (sort !== "file" || !rank) return sortByIds(entries, sort);

  // An entry the file does not hold yet, which a dev server can briefly see, sorts last.
  const position = (entry: E): number => rank.get(entry.id) ?? rank.size;
  const compare = compareIds(sort);

  return entries.toSorted((a, b) => position(a) - position(b) || compare(a.id, b.id));
}

/** An entry of a localized collection as one language shows it. */
export interface LocalizedEntry<E> {
  entry: E;
  /** The id without its language, shared by every translation. */
  slug: string;
  /** Whether the entry is the default language's, standing in for a missing translation. */
  isFallback: boolean;
}

function languages(): ContentI18n {
  if (!contentI18n) {
    throw new Error(
      "astronaut-cms: localized content needs content languages, set `i18n` in astro.config.",
    );
  }

  return contentI18n;
}

/**
 * The entries of a localized collection in `locale`, each slug once: its own
 * translation, or else the default language's, flagged as a fallback.
 *
 * @example
 * const posts = localizeEntries(await getCollection("posts"), Astro.currentLocale);
 */
export function localizeEntries<E extends { id: string }>(
  entries: readonly E[],
  locale: string,
): LocalizedEntry<E>[] {
  const { locales, defaultLocale } = languages();
  const bySlug = new Map<string, LocalizedEntry<E>>();

  for (const entry of entries) {
    const { locale: own, slug } = splitLocale(entry.id, locales);

    if (own === locale) bySlug.set(slug, { entry, slug, isFallback: false });
    else if (own === defaultLocale && !bySlug.has(slug))
      bySlug.set(slug, { entry, slug, isFallback: true });
  }

  return [...bySlug.values()];
}

/**
 * One entry of a localized collection in `locale`, or the default language's
 * when it has no translation, such as the texts of a localized singleton.
 *
 * @example
 * const texts = await getLocalizedEntry("texts", "site", Astro.currentLocale);
 */
export async function getLocalizedEntry<C extends CollectionKey>(
  collection: C,
  slug: string,
  locale: string,
): Promise<LocalizedEntry<CollectionEntry<C>> | undefined> {
  const { defaultLocale } = languages();
  const own = await getEntry(collection, joinLocale(locale, slug));
  const entry = own ?? (await getEntry(collection, joinLocale(defaultLocale, slug)));

  return entry && { entry, slug, isFallback: !own };
}

/**
 * The value of a `localized()` field in `locale`, or the default language's,
 * which the build guarantees.
 *
 * @example
 * const title = pickLocale(settings.data.imagefilm.title, Astro.currentLocale);
 */
export function pickLocale<T>(value: Partial<Record<string, T>>, locale: string): T {
  const { defaultLocale } = languages();
  const picked = value[locale] ?? value[defaultLocale];

  if (picked === undefined) {
    throw new Error(
      `astronaut-cms: a localized value has neither "${locale}" nor "${defaultLocale}".`,
    );
  }

  return picked;
}
