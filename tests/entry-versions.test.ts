import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/errors";
import {
  StaleWriteError,
  satisfies,
  staleWrite,
  type Precondition,
  type VersionedContent,
} from "@/server/storage/types";
import { StubStorage, storageOptions } from "./fixtures/storage";
import type { CollectionManifest } from "@/shared/types";

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

  protected override fetchFileContent(path: string): Promise<VersionedContent> {
    const file = this.files.get(path);

    return file ? Promise.resolve(file) : Promise.reject(new Error(`No such file: ${path}`));
  }

  protected override fetchRawEntry(collection: string, id: string, ext: string): Promise<VersionedContent> {
    return this.fetchFileContent(this.getEntryPath(collection, id, ext));
  }

  protected override commitFile(
    path: string,
    content: string,
    _message: string,
    precondition?: Precondition,
  ): Promise<string> {
    if (precondition && !satisfies(this.files.get(path)?.version, precondition)) {
      return Promise.reject(staleWrite(path));
    }

    return Promise.resolve(this.seed(path, content));
  }

  protected override removeFile(path: string, _message: string, expectedVersion?: string): Promise<void> {
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

class FileStorage extends StubStorage {
  override listEntries(collection: string) {
    return this.listFileCollectionEntries(collection);
  }

  protected override fetchFileContent(): Promise<VersionedContent> {
    return Promise.resolve({ content: "{" });
  }
}

class EntryFailureStorage extends StubStorage {
  calls = 0;
  private readonly failure: "provider" | "parse" | "missing";

  constructor(collections: CollectionManifest, failure: "provider" | "parse" | "missing") {
    super(storageOptions(collections));
    this.failure = failure;
  }

  protected override fetchRawEntry(
    _collection: string,
    _id: string,
    format: string,
  ): Promise<VersionedContent> {
    this.calls += 1;

    if (this.failure === "provider") return Promise.reject(new ApiError(503, "Unavailable"));
    if (this.failure === "parse") return Promise.resolve({ content: "{" });
    if (format === "json") {
      return Promise.reject(Object.assign(new Error("Missing"), { code: "ENOENT" }));
    }

    return Promise.resolve({ content: "name: Found\n" });
  }
}

/** A file collection's container held in memory, versioned by write count. */
class ContainerStorage extends StubStorage {
  file: VersionedContent = {
    content: JSON.stringify({ first: { name: "First" }, old: { name: "Old" }, last: { name: "Last" } }),
    version: "v1",
  };
  private writes = 1;

  override listEntries(collection: string) {
    return this.listFileCollectionEntries(collection);
  }

  protected override fetchFileContent(): Promise<VersionedContent> {
    return Promise.resolve(this.file);
  }

  protected override commitFile(
    path: string,
    content: string,
    _message: string,
    precondition?: Precondition,
  ): Promise<string> {
    if (precondition && !satisfies(this.file.version, precondition)) {
      return Promise.reject(staleWrite(path));
    }

    this.file = { content, version: `v${++this.writes}` };

    return Promise.resolve(this.file.version!);
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
    sort: "id",
    schema: { type: "object", shape: { title: { type: "string" } } },
  },
};

const dataCollections: CollectionManifest = {
  data: {
    name: "data",
    type: "data",
    loaderType: "glob",
    loaderPattern: "**/*.json",
    loaderBase: "src/data",
    loaderFileName: null,
    sort: "id",
    schema: null,
  },
};

const fileCollections: CollectionManifest = {
  authors: {
    name: "authors",
    type: "data",
    loaderType: "file",
    loaderPattern: null,
    loaderBase: null,
    loaderFileName: "src/data/authors.json",
    sort: "file",
    schema: { type: "object", shape: { name: { type: "string" } } },
  },
};

const PATH = "src/content/blog/hello.md";

function storage() {
  const store = new MemoryStorage(storageOptions(collections));

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

    await expect(store.saveEntry("posts", "hello", entry("v1"))).rejects.toBeInstanceOf(
      StaleWriteError,
    );
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

  it("atomically refuses to create an entry at an occupied path", async () => {
    const store = storage();

    await expect(
      store.saveEntry("posts", "hello", { ...entry(), createOnly: true }),
    ).rejects.toBeInstanceOf(StaleWriteError);
    await expect(store.getEntry("posts", "hello", "md")).resolves.toMatchObject({
      body: "\nBody\n",
    });
  });

  // A write carries one precondition, so a create that also names a version is
  // a claim on that version rather than on the path being free. The two used to
  // be separate flags and each backend decided for itself which of them won.
  it("prefers an offered version over absence when a create carries both", async () => {
    const store = storage();

    await expect(
      store.saveEntry("posts", "hello", { ...entry(), createOnly: true, expectedVersion: "v1" }),
    ).resolves.toBe("v2");
  });
});

describe("entry format fallback", () => {
  it.each(["provider", "parse"] as const)("surfaces a %s failure immediately", async (failure) => {
    const store = new EntryFailureStorage(dataCollections, failure);

    await expect(store.getEntry("data", "item", "json")).rejects.not.toThrow(/Entry not found/);
    expect(store.calls).toBe(1);
  });

  it("tries the next format when a file is genuinely absent", async () => {
    const store = new EntryFailureStorage(dataCollections, "missing");

    await expect(store.getEntry("data", "item", "json")).resolves.toMatchObject({
      data: { name: "Found" },
      format: "yaml",
    });
    expect(store.calls).toBe(2);
  });
});

describe("file collections", () => {
  it("surfaces malformed container content instead of presenting an empty collection", async () => {
    const store = new FileStorage(storageOptions(fileCollections));

    await expect(store.listEntries("authors")).rejects.toThrow();
  });

  // An entry's position can be the collection's order, so a rename rewrites the
  // container once, in place, against the version the editor read.
  it("renames an entry in place, refusing a stale container", async () => {
    const store = new ContainerStorage(storageOptions(fileCollections));

    await expect(store.renameEntry("authors", "old", "new", "v0")).rejects.toBeInstanceOf(
      StaleWriteError,
    );

    await store.renameEntry("authors", "old", "new", "v1");

    expect(Object.keys(JSON.parse(store.file.content))).toEqual(["first", "new", "last"]);
  });
});
