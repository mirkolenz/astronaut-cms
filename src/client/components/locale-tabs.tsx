import { Link } from "@tanstack/react-router";
import { joinLocale, localeLabel } from "@shared/i18n";
import { Button } from "@client/components/ui/button";

interface LocaleTabsProps {
  collection: string;
  locales: string[];
  active: string;
  subDir: string;
}

/**
 * Language selector for a localized collection, replacing the locale directories
 * that would otherwise show up as ordinary folders. Switching keeps the browsed
 * subfolder, so `en/guides` lands on `de/guides`.
 */
export function LocaleTabs({ collection, locales, active, subDir }: LocaleTabsProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-1">
      {locales.map((locale) => (
        <Button key={locale} asChild variant={locale === active ? "secondary" : "ghost"} size="sm">
          <Link
            to="/collections/$collection"
            params={{ collection }}
            search={{ dir: joinLocale(locale, subDir) }}
          >
            {localeLabel(locale)}
          </Link>
        </Button>
      ))}
    </div>
  );
}
