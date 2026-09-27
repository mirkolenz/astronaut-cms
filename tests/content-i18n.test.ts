import { describe, expect, it } from "vitest";
import { isLocalized, joinLocale, splitLocale, translationsOf } from "@/shared/i18n";
import { resolveContentI18n } from "@/integration/resolve-config";

const locales = ["en", "de"];

describe("locale ids", () => {
  it("splits and rejoins a localized id", () => {
    expect(splitLocale("de/guides/setup", locales)).toEqual({
      locale: "de",
      slug: "guides/setup",
    });
    expect(joinLocale("de", "guides/setup")).toBe("de/guides/setup");
  });

  it("leaves an id under an unknown first segment alone", () => {
    expect(splitLocale("guides/setup", locales)).toEqual({ locale: null, slug: "guides/setup" });
    expect(splitLocale("about", locales)).toEqual({ locale: null, slug: "about" });
  });

  it("treats a collection as localized only when no entry sits outside a locale", () => {
    expect(isLocalized(["en/about", "de/about"], locales)).toBe(true);
    expect(isLocalized(["en/about", "drafts/note"], locales)).toBe(false);
    expect(isLocalized([], locales)).toBe(true);
  });

  it("reports the missing translations of an entry", () => {
    const ids = new Set(["en/about", "de/about", "en/team"]);

    expect(translationsOf(ids, "team", locales)).toEqual([
      { locale: "en", id: "en/team", exists: true },
      { locale: "de", id: "de/team", exists: false },
    ]);
  });
});

describe("resolveContentI18n", () => {
  it("inherits the site's locales, normalizing path/codes entries", () => {
    expect(
      resolveContentI18n(
        {},
        { defaultLocale: "en", locales: ["en", { path: "pt", codes: ["pt-BR"] }] },
      ),
    ).toEqual({ locales: ["en", "pt"], defaultLocale: "en" });
  });

  // Astro names the default by *code* while addressing locales by *path*, and
  // entry ids are built from paths, so the CMS would otherwise browse and create
  // entries under a directory the site has no content in.
  it("maps a default locale code onto the path its entries live under", () => {
    expect(
      resolveContentI18n(
        {},
        { defaultLocale: "en", locales: [{ path: "english", codes: ["en"] }] },
      ),
    ).toEqual({ locales: ["english"], defaultLocale: "english" });
  });

  it("stays off without an i18n config, and when explicitly disabled", () => {
    expect(resolveContentI18n({}, undefined)).toBeNull();
    expect(
      resolveContentI18n({ i18n: false }, { defaultLocale: "en", locales: ["en", "de"] }),
    ).toBeNull();
  });

  it("lets the CMS config override the site's locales", () => {
    expect(
      resolveContentI18n(
        { i18n: { locales: ["en", "fr"] } },
        { defaultLocale: "de", locales: ["de"] },
      ),
    ).toEqual({ locales: ["en", "fr"], defaultLocale: "en" });
  });

  it("rejects an explicit default locale outside the configured languages", () => {
    expect(() => resolveContentI18n({ i18n: { locales: ["en"], defaultLocale: "de" } }, undefined))
      .toThrow('Content default locale "de" is not in the configured locales.');
  });

  it("uses a CMS default locale literally when the site maps codes to paths", () => {
    expect(resolveContentI18n(
      { i18n: { locales: ["en"], defaultLocale: "en" } },
      { defaultLocale: "en", locales: [{ path: "english", codes: ["en"] }] },
    )).toEqual({ locales: ["en"], defaultLocale: "en" });
  });
});
