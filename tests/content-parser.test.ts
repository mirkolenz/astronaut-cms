import { describe, expect, it } from "vitest";
import { parseContent, parseMultiEntryFile, serializeContent, serializeMultiEntryFile } from "@/shared/content-parser";

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

  it("keeps slug-only array entries visible and updates their slug on duplication", () => {
    const file = parseMultiEntryFile(JSON.stringify([{ slug: "first", title: "First" }, { slug: false }]), "json");

    file.entries.set("second", { ...file.entries.get("first") });

    const written = parseMultiEntryFile(serializeMultiEntryFile(file, "json"), "json").entries;

    expect([...written.keys()]).toEqual(["first", "false", "second"]);
    expect(written.get("second")).toEqual({ slug: "second", title: "First" });
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

  // A save rewrites the whole file, which must not cost the comments and blank
  // lines it left alone, inside an edited entry or around it.
  it("keeps YAML comments and blank lines", () => {
    const raw = "# Team\n\n- id: 1 # first\n  name: A\n\n- id: 2\n  # shown\n  name: B\n  role: x\n";
    const file = parseMultiEntryFile(raw, "yaml");

    expect(serializeMultiEntryFile(file, "yaml")).toBe(raw);

    file.entries.set("2", { id: 2, name: "Bee", role: "x" });

    expect(serializeMultiEntryFile(file, "yaml")).toBe(raw.replace("name: B", "name: Bee"));
  });

  it("keeps YAML comments of an object layout", () => {
    const raw = "a:\n  name: A\n\n# second\nb:\n  name: B # old\n";
    const file = parseMultiEntryFile(raw, "yaml");

    file.entries.set("b", { name: "Bee" });

    expect(serializeMultiEntryFile(file, "yaml")).toBe(raw.replace("name: B", "name: Bee"));
  });

  it("keeps slug-based YAML comments with their entries when reordered", () => {
    const raw = "- slug: first # first\n  name: A\n- slug: second # second\n  name: B\n";
    const file = parseMultiEntryFile(raw, "yaml");

    file.entries = new Map([...file.entries].reverse());

    expect(serializeMultiEntryFile(file, "yaml")).toBe(
      "- slug: second # second\n  name: B\n- slug: first # first\n  name: A\n",
    );
  });
});

it("refuses TOML values that would be dropped or cannot be represented", () => {
  expect(() => serializeContent({ title: null }, "", "toml")).toThrow(/TOML cannot store/);
  expect(() => serializeContent({ title: undefined }, "", "toml")).toThrow(/TOML cannot store/);
  expect(() =>
    serializeMultiEntryFile(
      { layout: "object", entries: new Map([["first", { tags: ["a", null] }]]) },
      "toml",
    ),
  ).toThrow(/TOML cannot store/);

  const { data } = parseContent("published = 2026-01-01\n", "toml");
  expect(serializeContent(data, "", "toml")).toContain("published = 2026-01-01");
});
