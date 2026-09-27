import { describe, expect, it } from "vitest";
import { StaleWriteError, staleWrite, type VersionedContent } from "@server/storage/types";
import { StubStorage } from "./fixtures/storage";
import type { CollectionManifest } from "@shared/types";

// A save carries the version the edit was made against, so a write cannot
// silently discard one that landed while the editor was open. StorageBase is
// what threads it from the read to the backend's precondition; these pin that
// threading, whichever backend ends up enforcing it.

/** A backend whose whole repository is a map, versioned by write count. */
class MemoryStorage extends StubStorage {
  private readonly files = new Map<string, VersionedContent>();
  private writes = 0;

  seed(path: string, content: string): string {
    const version = `v${++this.writes}`;

    this.files.set(path, { content, version });

    return version;
  }

  protected fetchFileContent(path: string): Promise<VersionedContent> {
    const file = this.files.get(path);

    return file ? Promise.resolve(file) : Promise.reject(new Error(`No such file: ${path}`));
  }

  protected fetchRawEntry(collection: string, id: string, ext: string): Promise<VersionedContent> {
    return this.fetchFileContent(this.getEntryPath(collection, id, ext));
  }

  protected commitFile(
    path: string,
    content: string,
    _message: string,
    expectedVersion?: string,
  ): Promise<string> {
    if (expectedVersion !== undefined && this.files.get(path)?.version !== expectedVersion) {
      return Promise.reject(staleWrite(path));
    }

    return Promise.resolve(this.seed(path, content));
  }

  protected removeFile(path: string, _message: string, expectedVersion?: string): Promise<void> {
    if (expectedVersion !== undefined && this.files.get(path)?.version !== expectedVersion) {
      return Promise.reject(staleWrite(path));
    }

    this.files.delete(path);

    return Promise.resolve();
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  override listEntries() {
    return Promise.resolve([{ id: "hello", collection: "posts", format: "md" as const }]);
  }
}

const collections: CollectionManifest = {
  posts: {
    name: "posts",
    type: "content",
    loaderType: "glob",
    loaderPattern: "**/*.md",
    loaderBase: "src/content/blog",
    loaderFileName: null,
    schema: { type: "object", shape: { title: { type: "string" } } },
  },
};

const PATH = "src/content/blog/hello.md";

function storage() {
  const store = new MemoryStorage({
    collections,
    mediaDirectory: "src/assets",
    mediaExtensions: [".png"],
    maxFileSize: null,
    login: "alice",
  });

  store.seed(PATH, "---\ntitle: Hello\n---\n\nBody\n");

  return store;
}

const entry = (version?: string) => ({
  data: { title: "Hello" },
  body: "Edited",
  format: "md" as const,
  ...(version && { expectedVersion: version }),
});

describe("entry versions", () => {
  it("hands out the version of the file the entry lives in", async () => {
    const read = await storage().getEntry("posts", "hello");

    expect(read.version).toBe("v1");
  });

  it("refuses a save based on a version the file has moved past", async () => {
    const store = storage();

    store.seed(PATH, "someone else wrote this");

    await expect(store.saveEntry("posts", "hello", entry("v1"))).rejects.toBeInstanceOf(StaleWriteError);
  });

  it("answers a save with the version to carry into the next one", async () => {
    const store = storage();
    const saved = await store.saveEntry("posts", "hello", entry("v1"));

    expect(saved).toBe("v2");
    await expect(store.saveEntry("posts", "hello", entry(saved))).resolves.toBe("v3");
  });

  // A deletion is derived from a read exactly as a save is, so it is guarded the
  // same way rather than taking the last word because it happens to be a delete.
  it("refuses a delete based on a version the file has moved past", async () => {
    const store = storage();

    store.seed(PATH, "someone else wrote this");

    await expect(store.deleteEntry("posts", "hello", "v1")).rejects.toBeInstanceOf(StaleWriteError);
    expect(store.has(PATH)).toBe(true);

    await expect(store.deleteEntry("posts", "hello", "v2")).resolves.toBeUndefined();
    expect(store.has(PATH)).toBe(false);
  });

  // Nothing to compare against is not the same as a conflict: a new entry, and
  // any caller that did not read first, still writes.
  it("takes the last word when no version is offered", async () => {
    const store = storage();

    store.seed(PATH, "someone else wrote this");

    await expect(store.saveEntry("posts", "hello", entry())).resolves.toBe("v3");
  });
});
