import { describe, expect, it } from "vitest";
import { parseMultiEntryFile, serializeMultiEntryFile } from "@shared/content-parser";

// An array-backed file() collection keys its entries by an `id` field embedded in
// each item, so the map key and the data can disagree. The key is the entry id,
// and it has to win: duplicating an entry copies its data verbatim, embedded id
// and all, and a file that came back with two identical ids would collapse to one
// entry on the next read, taking the other's content with it.
describe("multi-entry array files", () => {
  const raw = JSON.stringify([{ id: "first", title: "First" }]);
  const { entries, layout } = parseMultiEntryFile(raw, "json");

  it("writes the map key as the id, overriding a stale embedded one", () => {
    entries.second = { ...entries.first };

    const written = parseMultiEntryFile(
      serializeMultiEntryFile(entries, "json", layout),
      "json",
    ).entries;

    expect(Object.keys(written)).toEqual(["first", "second"]);
    expect(written.second).toEqual({ id: "second", title: "First" });
  });
});
