import { describe, expect, it } from "vitest";
import { getLocalizedEntry, localizeEntries, pickLocale } from "@/content";

const entries = ["de/about", "en/about", "de/news/a", "en/only"].map((id) => ({ id }));

describe("localized content", () => {
  it("shows each slug once, falling back to the default language", () => {
    expect(
      localizeEntries(entries, "en").map(({ entry, slug, isFallback }) => [
        entry.id,
        slug,
        isFallback,
      ]),
    ).toEqual([
      ["en/about", "about", false],
      ["de/news/a", "news/a", true],
      ["en/only", "only", false],
    ]);
  });

  it("finds one entry in a language, or the default language's", async () => {
    expect(await getLocalizedEntry("texts", "site", "en")).toMatchObject({
      entry: { id: "en/site" },
      isFallback: false,
    });
    expect(await getLocalizedEntry("texts", "legal", "en")).toMatchObject({
      entry: { id: "de/legal" },
      isFallback: true,
    });
    expect(await getLocalizedEntry("texts", "missing", "en")).toBeUndefined();
  });

  it("picks a localized value, falling back to the default language", () => {
    expect(pickLocale({ de: "Hallo", en: "Hello" }, "en")).toBe("Hello");
    expect(pickLocale({ de: "Hallo" }, "en")).toBe("Hallo");
  });
});
