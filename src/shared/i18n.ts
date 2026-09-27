/**
 * The one place the localized-entry convention lives: a localized collection
 * stores every entry under a leading locale segment (`en/about`, `de/about`),
 * the layout Astro's own i18n recipe recommends. The rest of the id is shared
 * across translations, which is what lets the admin pair them up.
 *
 * The admin UI and the AI assistant both derive every locale decision from these
 * helpers, so the convention is never restated (and cannot drift) at a second site.
 */

/** The site's content languages, mirrored from `astro.config`'s own `i18n`. */
export interface ContentI18n {
  locales: string[];
  defaultLocale: string;
}

export interface LocalizedId {
  /** Leading locale segment, or `null` when the id carries none. */
  locale: string | null;
  /** The id without its locale segment — stable across translations. */
  slug: string;
}

/** The locale a path sits directly under, or `null` when it sits under none. */
export function localeOf(path: string, locales: string[]): string | null {
  const slash = path.indexOf("/");
  const head = slash === -1 ? path : path.slice(0, slash);

  return locales.includes(head) ? head : null;
}

export function splitLocale(id: string, locales: string[]): LocalizedId {
  const locale = localeOf(id, locales);

  return locale ? { locale, slug: id.slice(locale.length + 1) } : { locale: null, slug: id };
}

export function joinLocale(locale: string, slug: string): string {
  return slug ? `${locale}/${slug}` : locale;
}

/**
 * Whether a collection's entries follow the locale-directory convention.
 *
 * Detecting this from the entries themselves keeps multilingual support
 * zero-config: no collection has to declare itself localized. The rule is
 * deliberately strict — a single entry outside a locale directory opts the whole
 * collection back into the plain folder view, so no entry can ever be hidden
 * behind a locale tab. An empty collection counts as localized, so the first
 * entry of a new collection can be created straight into a language.
 */
export function isLocalized(ids: Iterable<string>, locales: string[]): boolean {
  for (const id of ids) {
    if (localeOf(id, locales) === null) return false;
  }

  return true;
}

export interface Translation {
  locale: string;
  /** Id the translation has (or would have, when `exists` is false). */
  id: string;
  exists: boolean;
}

/**
 * Every locale's counterpart of `slug`, with missing translations flagged.
 * Takes the collection's ids as a prepared set, because a listing calls this
 * once per row and would otherwise rebuild it for each of them.
 */
export function translationsOf(
  ids: ReadonlySet<string>,
  slug: string,
  locales: string[],
): Translation[] {
  return locales.map((locale) => {
    const id = joinLocale(locale, slug);

    return { locale, id, exists: ids.has(id) };
  });
}

const labels = new Map<string, string>();

/**
 * Endonym for a locale ("Deutsch" for `de`), falling back to the raw code for a
 * tag the runtime cannot name. Used for every locale label in the admin, so no
 * hard-coded language list has to be maintained alongside the configured one.
 *
 * Endonyms never depend on the admin's own language, so they are cached for the
 * session: constructing an `Intl.DisplayNames` costs orders of magnitude more
 * than the lookup, and a listing asks for the same handful of labels per row.
 */
export function localeLabel(locale: string): string {
  let label = labels.get(locale);

  if (label === undefined) {
    try {
      label = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
    } catch {
      label = locale;
    }

    labels.set(locale, label);
  }

  return label;
}
