import { useTranslation } from "react-i18next";
import { localeLabel, translationsOf } from "@shared/i18n";
import type { CollectionI18n } from "@client/lib/content-i18n";
import { Badge } from "@client/components/ui/badge";

interface TranslationStatusProps {
  i18n: CollectionI18n;
  /** Locale-free id shared by all translations of one entry. */
  slug: string;
}

/**
 * Which languages an entry has been translated into. A site that falls back to
 * its default locale renders a missing translation as if nothing were wrong, so
 * the listing is the only place an editor can spot the gap.
 */
export function TranslationStatus({ i18n, slug }: TranslationStatusProps) {
  const { t } = useTranslation();

  return (
    <span className="flex items-center gap-1">
      {translationsOf(i18n.ids, slug, i18n.locales).map(({ locale, exists }) => (
        <Badge
          key={locale}
          variant={exists ? "secondary" : "outline"}
          className={exists ? undefined : "border-dashed text-muted-foreground/50"}
          title={t(exists ? ($) => $.i18n.translated : ($) => $.i18n.missingTranslation, {
            language: localeLabel(locale),
          })}
        >
          {locale}
        </Badge>
      ))}
    </span>
  );
}
