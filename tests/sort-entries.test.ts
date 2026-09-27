import { describe, expect, it } from "vitest";
import { sortEntries } from "@/content";

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
