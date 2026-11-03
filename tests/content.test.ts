import { describe, expect, it } from "vitest";
import { getLocalizedEntry, localizeEntries, pickLocale, sortEntries } from "@/content";

const ids = (collection: string, ...list: string[]) =>
  sortEntries(list.map((id) => ({ id, collection }))).map((entry) => entry.id);

// Astro's content store returns a collection sorted by id, so the order a
// collection declares is restored here, the same one the admin shows.
describe("sortEntries", () => {
  it("keeps astro's id order by default", () => {
    expect(ids("posts", "b", "10", "2")).toEqual(["10", "2", "b"]);
  });

  it("compares digit runs as numbers for natural order", () => {
    expect(ids("pages", "10", "b", "2")).toEqual(["2", "10", "b"]);
  });

  it("restores file order, with entries the file lacks last", () => {
    expect(ids("events", "a", "new", "b", "c")).toEqual(["b", "c", "a", "new"]);
  });
});

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
