import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { localeLabel } from "@/shared/i18n";
import { setUiLocale, uiLocales } from "@/client/i18n";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/** Admin UI language. Unrelated to the site's content languages. */
export function UiLocaleMenu() {
  const { i18n } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={localeLabel(i18n.language)}>
          <Languages />
          {i18n.language}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={i18n.language} onValueChange={setUiLocale}>
          {uiLocales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {localeLabel(locale)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
