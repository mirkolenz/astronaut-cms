import { describe, expect, it } from "vitest";
import {
  assertEntryWritable,
  validateAgainstSchema,
  ContentValidationError,
} from "@client/lib/validation";
import type { CollectionManifestEntry } from "@shared/types";

// An entry that does not match its collection schema is fatal to the site: Astro
// throws while syncing content and the dev server exits. These pin the two ways
// an agent edit used to be able to produce one.
const posts: CollectionManifestEntry = {
  name: "posts",
  type: "content",
  loaderType: "glob",
  loaderPattern: "**/*.md",
  loaderBase: "src/content/blog",
  loaderFileName: null,
  schema: {
    type: "object",
    shape: {
      title: { type: "string" },
      publishDate: { type: "date" },
      cover: { type: "image", optional: true },
      draft: { type: "boolean", optional: true },
    },
  },
};

describe("validateAgainstSchema", () => {
  it("accepts an entry that matches the collection schema", () => {
    expect(validateAgainstSchema(posts, { title: "Hello", publishDate: "2026-01-01" })).toEqual([]);
  });

  it("rejects an edit that dropped a required field", () => {
    const diagnostics = validateAgainstSchema(posts, { publishDate: "2026-01-01" });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ path: "title" });
  });

  it("rejects a date the site cannot parse", () => {
    const diagnostics = validateAgainstSchema(posts, { title: "Hello", publishDate: "next week" });

    expect(diagnostics[0]).toMatchObject({ path: "publishDate" });
  });

  it("accepts a real date read back as a Date (TOML) and an ISO timestamp", () => {
    expect(
      validateAgainstSchema(posts, { title: "Hello", publishDate: new Date("2026-01-01") }),
    ).toEqual([]);
    expect(
      validateAgainstSchema(posts, { title: "Hello", publishDate: "2026-01-01T10:00:00Z" }),
    ).toEqual([]);
  });
});

// Storage refuses the write itself, so no caller can skip the check.
const source = {
  listEntries: () => Promise.resolve([{ id: "a" }]),
  listMedia: () => Promise.resolve([{ path: "hero.svg" }]),
};

const complete = { title: "T", publishDate: "2026-01-01", cover: "/src/assets/hero.svg" };

const write = (data: Record<string, unknown>) => ({
  col: posts,
  id: "x",
  data,
  body: "",
  format: "md",
});

describe("assertEntryWritable", () => {
  // The build resolves a relative asset value against the entry it is written in
  // (and so does the render-time resolver), so refusing to save one would make an
  // entry the site builds fine uneditable in the CMS.
  it("accepts an asset path written relative to the entry", async () => {
    await expect(
      assertEntryWritable(source, write({ ...complete, cover: "../../assets/hero.svg" })),
    ).resolves.toBeUndefined();
  });

  it("refuses an entry missing a required field", async () => {
    await expect(
      assertEntryWritable(source, write({ publishDate: "2026-01-01" })),
    ).rejects.toBeInstanceOf(ContentValidationError);
  });

  it("refuses an invented asset path", async () => {
    await expect(
      assertEntryWritable(source, write({ ...complete, cover: "/src/assets/nope.png" })),
    ).rejects.toThrow(/not in the media library/);
  });

  it("allows a complete entry", async () => {
    await expect(assertEntryWritable(source, write(complete))).resolves.toBeUndefined();
  });
});

// The storage layer reads the content model itself. When it did not — the
// backend was constructed with an empty manifest — every write failed with
// "Unknown collection" instead of being validated.
describe("storage knows the content model", () => {
  it("validates a write rather than rejecting the collection", async () => {
    const { getStorage } = await import("@client/lib/storage");

    await expect(
      getStorage().saveEntry("posts", "hello", { data: {}, body: "", format: "md" }),
    ).rejects.toBeInstanceOf(ContentValidationError);
  });
});
