import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTRY_POINTS, exportsEntry, specifierOf } from "@/entry-points";

// `package.json` cannot import the table, so this is what keeps it honest.
// Without it an entry point added in one place and forgotten in the other only
// shows up as a dev server quietly loading a stale `dist/`.
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as {
  name: string;
  exports: Record<string, Record<string, string>>;
};

describe("entry points", () => {
  it("matches the exports package.json declares", () => {
    expect(pkg.exports).toEqual(
      Object.fromEntries(ENTRY_POINTS.map((entry) => [entry.subpath, exportsEntry(entry)])),
    );
  });

  it("names every specifier under the package", () => {
    expect(ENTRY_POINTS.map(specifierOf).every((id) => id.startsWith(pkg.name))).toBe(true);
  });
});
