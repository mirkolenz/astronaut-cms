import "./types";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import config from "@/client/lib/config";
import en from "./locales/en";
import de from "./locales/de";

const resources = {
  en: { translation: en },
  de: { translation: de },
};

export const uiLocales = Object.keys(resources);

const STORAGE_KEY = "astronaut-cms:ui-locale";
const stored = localStorage.getItem(STORAGE_KEY);

/** Switches the admin UI language and remembers the choice for the next visit. */
export function setUiLocale(locale: string): void {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

void i18n.use(initReactI18next).init({
  resources,
  // The configured `locale` is the default; a language picked in the header wins
  // from then on, so a shared deployment does not force one language on everyone.
  lng: stored && uiLocales.includes(stored) ? stored : config.locale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
