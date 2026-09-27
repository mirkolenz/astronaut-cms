import { Link } from "@tanstack/react-router";
import { joinLocale, localeLabel } from "@/shared/i18n";
import { Button } from "@/client/components/ui/button";
import { ButtonGroup } from "@/client/components/ui/button-group";

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
    <ButtonGroup>
      {locales.map((locale) => (
        <Button
          key={locale}
          asChild
          variant="outline"
          size="sm"
          className="aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
        >
          <Link
            aria-current={locale === active ? "page" : undefined}
            to="/collections/$collection"
            params={{ collection }}
            search={{ dir: joinLocale(locale, subDir) }}
          >
            {localeLabel(locale)}
          </Link>
        </Button>
      ))}
    </ButtonGroup>
  );
}
