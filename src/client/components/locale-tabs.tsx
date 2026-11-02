import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { cn } from "cn";
import { localeLabel, translationsOf } from "@/shared/i18n";
import type { CollectionI18n } from "@/client/lib/content-i18n";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { ButtonGroup } from "@/client/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";

/** How a language that is missing shows, wherever languages are listed. */
export const MISSING = "border-dashed text-muted-foreground";

/** A language and what it opens: a folder of the collection, or one entry's translation. */
type LocaleTab = { locale: string } & ({ dir: string } | { entry: string; exists: boolean });

interface LocaleTabsProps {
  collection: string;
  tabs: readonly LocaleTab[];
  active: string;
  /** Creates a missing translation from its id, offered while `canCreate` holds. */
  onCreate?: (id: string) => void;
  canCreate?: boolean;
}

/**
 * Moves between the languages of a collection or of an entry.
 * A missing translation is offered for creation instead, as a copy of the entry on screen,
 * so the translator starts from real text rather than an empty form.
 */
export function LocaleTabs({ collection, tabs, active, onCreate, canCreate }: LocaleTabsProps) {
  const { t } = useTranslation();

  return (
    <ButtonGroup aria-label={t(($) => $.i18n.language)}>
      {tabs.map((tab) => {
        const language = localeLabel(tab.locale);
        const current = tab.locale === active ? "page" : undefined;

        if ("dir" in tab || tab.exists) {
          const link =
            "dir" in tab
              ? { to: "/collections/$collection", params: { collection }, search: { dir: tab.dir } }
              : { to: "/collections/$collection/$entry", params: { collection, entry: tab.entry } };

          return (
            <Button
              key={tab.locale}
              asChild
              variant="outline"
              size="sm"
              className="aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
            >
              <Link
                aria-current={current}
                to={link.to}
                params={link.params}
                search={link.search ?? {}}
              >
                {language}
              </Link>
            </Button>
          );
        }

        const { entry } = tab;

        return (
          <Tooltip key={tab.locale}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={MISSING}
                disabled={!onCreate || !canCreate}
                onClick={() => onCreate?.(entry)}
              >
                <Plus />
                {language}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(($) => $.i18n.createTranslation, { language })}</TooltipContent>
          </Tooltip>
        );
      })}
    </ButtonGroup>
  );
}

/**
 * Which languages an entry has been translated into. A site that falls back to
 * its default locale renders a missing translation as if nothing were wrong, so
 * the listing is the only place an editor can spot the gap.
 */
export function TranslationStatus({ i18n, slug }: { i18n: CollectionI18n; slug: string }) {
  const { t } = useTranslation();

  return (
    <span className="flex items-center gap-1">
      {translationsOf(i18n.ids, slug, i18n.locales).map(({ locale, exists }) => {
        const language = localeLabel(locale);

        return (
          <Tooltip key={locale}>
            <TooltipTrigger asChild>
              <Badge variant={exists ? "secondary" : "outline"} className={cn(!exists && MISSING)}>
                {language}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {exists
                ? t(($) => $.i18n.translated, { language })
                : t(($) => $.i18n.missingTranslation, { language })}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}
