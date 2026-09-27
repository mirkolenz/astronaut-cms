import { describe, expect, it } from "vitest";
import { StorageBase } from "@client/lib/storage/base";
import type { CollectionInfo } from "@shared/types";

// A concrete StorageBase that exposes the protected path helpers, so we can pin
// that glob-collection storage paths come from the loader's `base`
// (content.config.ts) rather than being hard-coded from the collection key.
class TestStorage extends StorageBase {
  collectionPath(collection: string) {
    return this.getCollectionPath(collection);
  }
  entryPath(collection: string, id: string, format: string) {
    return this.getEntryPath(collection, id, format);
  }
  entries(collection: string, paths: string[]) {
    return this.entriesFromTreePaths(collection, paths);
  }

  listEntries() {
    return Promise.resolve([]);
  }
  listMedia() {
    return Promise.resolve([]);
  }
  uploadMedia() {
    return Promise.reject(new Error("n/a"));
  }
  replaceMedia() {
    return Promise.reject(new Error("n/a"));
  }
  renameMedia() {
    return Promise.reject(new Error("n/a"));
  }
  deleteMedia() {
    return Promise.resolve();
  }
  saveEntry() {
    return Promise.resolve();
  }
  deleteEntry() {
    return Promise.resolve();
  }
  reorderEntries() {
    return Promise.resolve();
  }
  publish() {
    return Promise.resolve();
  }
  update() {
    return Promise.resolve();
  }
  discard() {
    return Promise.resolve();
  }
  getStatus() {
    return Promise.resolve({ hasBranch: false, branch: "", ahead: 0, behind: 0 });
  }
}

const schemas: Record<string, CollectionInfo> = {
  // Collection key ("posts") differs from its directory ("blog").
  posts: { name: "posts", type: "content", loaderType: "glob", loaderBase: "src/content/blog" },
  // No base captured -> conventional fallback.
  notes: { name: "notes", type: "content", loaderType: "glob", loaderBase: null },
};

describe("StorageBase glob paths", () => {
  const storage = new TestStorage(schemas, "src/assets");

  it("resolves the collection path from the loader base, not the key", () => {
    expect(storage.collectionPath("posts")).toBe("src/content/blog");
    expect(storage.entryPath("posts", "hello", "mdx")).toBe("src/content/blog/hello.mdx");
  });

  it("maps repository tree paths under the loader base to entries", () => {
    const entries = storage.entries("posts", [
      "src/content/blog/a.md",
      "src/content/blog/nested/b.mdx",
      "src/content/posts/c.md", // the key's directory, not the base — must be ignored
      "src/assets/x.png",
    ]);
    expect(entries.map((e) => e.id)).toEqual(["a", "nested/b"]);
  });

  it("falls back to src/content/<name> when no base is captured", () => {
    expect(storage.collectionPath("notes")).toBe("src/content/notes");
  });
});
