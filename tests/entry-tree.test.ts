import { describe, expect, it } from "vitest";
import { dirSegments, listDirectory, parentDir } from "@/client/lib/entry-tree";
import type { EntryMeta } from "@/shared/types";

const entries: EntryMeta[] = [
  "getting-started",
  "guides/asset-handling",
  "guides/deployment",
  "guides/advanced/caching",
  "reference/api",
].map((id) => ({ id, collection: "docs", format: "md", path: `src/content/docs/${id}.md` }));

describe("listDirectory", () => {
  it("groups the root into immediate folders and files", () => {
    const { folders, files } = listDirectory(entries, "", (e) => e.id);

    expect(folders).toEqual([
      { name: "guides", path: "guides" },
      { name: "reference", path: "reference" },
    ]);
    expect(files.map((f) => f.id)).toEqual(["getting-started"]);
  });

  it("drills into a nested folder one level at a time", () => {
    const { folders, files } = listDirectory(entries, "guides", (e) => e.id);

    expect(folders).toEqual([{ name: "advanced", path: "guides/advanced" }]);
    expect(files.map((f) => f.id)).toEqual(["guides/asset-handling", "guides/deployment"]);
  });

  it("lists the leaf files of a deep folder", () => {
    const { folders, files } = listDirectory(entries, "guides/advanced", (e) => e.id);

    expect(folders).toEqual([]);
    expect(files.map((f) => f.id)).toEqual(["guides/advanced/caching"]);
  });
});

describe("path helpers", () => {
  it("derives the parent directory", () => {
    expect(parentDir("guides/advanced/caching")).toBe("guides/advanced");
    expect(parentDir("top")).toBe("");
  });

  it("builds cumulative breadcrumb segments", () => {
    expect(dirSegments("guides/advanced")).toEqual([
      { name: "guides", path: "guides" },
      { name: "advanced", path: "guides/advanced" },
    ]);
    expect(dirSegments("")).toEqual([]);
  });
});
