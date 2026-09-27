import { describe, expect, it } from "vitest";
import { parseMultiEntryFile, serializeMultiEntryFile } from "@/shared/content-parser";

describe("multi-entry files", () => {
  // An array-backed file() collection keys its entries by an `id` field embedded in
  // each item, so the map key and the data can disagree. The key is the entry id,
  // and it has to win: duplicating an entry copies its data verbatim, embedded id
  // and all, and a file that came back with two identical ids would collapse to one
  // entry on the next read, taking the other's content with it.
  it("writes the map key as the id, overriding a stale embedded one", () => {
    const file = parseMultiEntryFile(JSON.stringify([{ id: "first", title: "First" }]), "json");

    file.entries.set("second", { ...file.entries.get("first") });

    const written = parseMultiEntryFile(serializeMultiEntryFile(file, "json"), "json").entries;

    expect([...written.keys()]).toEqual(["first", "second"]);
    expect(written.get("second")).toEqual({ id: "second", title: "First" });
  });

  // File order can be a collection's order, and an object would move integer-like
  // ids to the front.
  it("keeps file order for integer-like ids", () => {
    const { entries } = parseMultiEntryFile(JSON.stringify([{ id: 10 }, { id: 2 }]), "json");

    expect([...entries.keys()]).toEqual(["10", "2"]);
  });

  // Astro skips a `$schema` reference, so it is no entry, and a rewrite keeps it.
  it("keeps a $schema reference out of the entries", () => {
    const raw = JSON.stringify({ $schema: "./schema.json", a: { name: "A" } });
    const file = parseMultiEntryFile(raw, "json");

    expect([...file.entries.keys()]).toEqual(["a"]);
    expect(JSON.parse(serializeMultiEntryFile(file, "json"))).toEqual(JSON.parse(raw));
  });
});
