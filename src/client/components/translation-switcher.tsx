import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Languages, Plus } from "lucide-react";
import { localeLabel, translationsOf } from "@shared/i18n";
import type { CollectionI18n } from "@client/lib/content-i18n";
import { Button } from "@client/components/ui/button";

interface TranslationSwitcherProps {
  collection: string;
  i18n: CollectionI18n;
  /** Locale-free id shared by all translations of this entry. */
  slug: string;
  /** Locale of the entry currently open. */
  active: string;
  /** Blocked while the entry is unsaved: a translation is seeded from the stored file. */
  canCreate: boolean;
  onCreate: (id: string) => void;
}

/**
 * Moves between an entry's languages, and creates the ones that do not exist yet
 * as a copy of the entry on screen — so the translator edits real text and
 * inherits its frontmatter, components and media instead of an empty form.
 */
export function TranslationSwitcher({
  collection,
  i18n,
  slug,
  active,
  canCreate,
  onCreate,
}: TranslationSwitcherProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <Languages className="size-4 text-muted-foreground" />
      {translationsOf(i18n.ids, slug, i18n.locales).map(({ locale, id, exists }) => {
        const label = localeLabel(locale);

        if (locale === active) {
          return (
            <Button key={locale} variant="secondary" size="sm" disabled>
              {label}
            </Button>
          );
        }

        if (exists) {
          return (
            <Button key={locale} asChild variant="ghost" size="sm">
              <Link to="/collections/$collection/$entry" params={{ collection, entry: id }}>
                {label}
              </Link>
            </Button>
          );
        }

        return (
          <Button
            key={locale}
            variant="outline"
            size="sm"
            className="border-dashed text-muted-foreground/60 hover:border-solid"
            onClick={() => onCreate(id)}
            disabled={!canCreate}
            title={t(($) => $.i18n.createTranslation, { language: label })}
          >
            <Plus />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
