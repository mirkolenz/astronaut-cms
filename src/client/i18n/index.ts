import "./types";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import config from "virtual:astronaut-cms/config";
import en from "./locales/en";
import de from "./locales/de";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: config.locale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
