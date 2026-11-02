import { describe, expect, it } from "vitest";
import { ContentValidationError } from "@/shared/diagnostics";
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

    return file
      ? Promise.resolve(file)
      : Promise.reject(Object.assign(new Error(`No such file: ${path}`), { code: "ENOENT" }));
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

  protected override removeFile(
    path: string,
    _message: string,
    expectedVersion?: string,
  ): Promise<void> {
    if (expectedVersion !== undefined && this.files.get(path)?.version !== expectedVersion) {
      return Promise.reject(staleWrite(path));
    }

    this.files.delete(path);

    return Promise.resolve();
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  content(path: string): string | undefined {
    return this.files.get(path)?.content;
  }

  protected override globPaths() {
    return Promise.resolve(this.files.keys());
  }
}

class FileStorage extends StubStorage {
  protected override fetchFileContent(): Promise<VersionedContent> {
    return Promise.resolve({ content: "{" });
  }
}

/** A file collection's container held in memory, versioned by write count. */
class ContainerStorage extends StubStorage {
  file: VersionedContent = {
    content: JSON.stringify({
      first: { name: "First" },
      old: { name: "Old" },
      last: { name: "Last" },
    }),
    version: "v1",
  };
  private writes = 1;

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
    singleton: null,
    schema: { type: "object", shape: { title: { type: "string" } } },
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
    singleton: null,
    schema: { type: "object", shape: { name: { type: "string" } } },
  },
};

const tomlCollections: CollectionManifest = {
  events: {
    name: "events",
    type: "data",
    loaderType: "glob",
    loaderPattern: "**/*.toml",
    loaderBase: "src/data/events",
    loaderFileName: null,
    sort: "id",
    singleton: null,
    schema: { type: "object", shape: { published: { type: "date" } } },
  },
};

const untypedTomlCollections: CollectionManifest = {
  events: { ...tomlCollections.events!, schema: null },
};

const unionTomlCollections: CollectionManifest = {
  events: {
    ...tomlCollections.events!,
    schema: {
      type: "object",
      shape: {
        event: {
          type: "union",
          discriminator: "kind",
          variants: [
            {
              type: "object",
              shape: { kind: { type: "literal", value: "scheduled" }, at: { type: "date" } },
            },
            {
              type: "object",
              shape: { kind: { type: "literal", value: "draft" }, note: { type: "string" } },
            },
          ],
        },
      },
    },
  },
};

const tomlFileCollections: CollectionManifest = {
  events: {
    ...tomlCollections.events!,
    loaderType: "file",
    loaderPattern: null,
    loaderBase: null,
    loaderFileName: "src/data/events.toml",
    schema: null,
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
    await expect(store.getEntry("posts", "hello")).resolves.toMatchObject({
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

/** Entry data as it comes back from the JSON API. */
const overJson = (data: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(data));

it("restores a new date declared by the collection schema", async () => {
  const store = new MemoryStorage(storageOptions(tomlCollections));
  const path = "src/data/events/launch.toml";

  await store.saveEntry("events", "launch", {
    data: { published: "2026-02-03" },
    body: "",
    format: "toml",
    createOnly: true,
  });

  expect(store.content(path)).toContain("published = 2026-02-03\n");

  await expect(
    store.saveEntry("events", "launch", {
      data: { published: "not-a-date" },
      body: "",
      format: "toml",
    }),
  ).rejects.toBeInstanceOf(ContentValidationError);
});

it("restores a new date inside a discriminated union", async () => {
  const store = new MemoryStorage(storageOptions(unionTomlCollections));
  const path = "src/data/events/launch.toml";

  await store.saveEntry("events", "launch", {
    data: { event: { kind: "scheduled", at: "2026-02-03" } },
    body: "",
    format: "toml",
    createOnly: true,
  });

  expect(store.content(path)).toContain("at = 2026-02-03\n");
});

it("keeps untyped TOML dates and quoted date-looking text distinct", async () => {
  const store = new MemoryStorage(storageOptions(untypedTomlCollections));
  const path = "src/data/events/launch.toml";

  store.seed(
    path,
    'published = 2026-01-01\nupdated = 2026-01-01T10:00:00+02:00\nnote = "2026-01-01"\n',
  );

  const read = await store.getEntry("events", "launch");
  const data = overJson(read.data);

  await store.saveEntry("events", "launch", { data, body: "", format: "toml" });

  expect(store.content(path)).toContain("published = 2026-01-01\n");
  expect(store.content(path)).toContain("updated = 2026-01-01T10:00:00.000+02:00\n");
  expect(store.content(path)).toContain('note = "2026-01-01"\n');

  await store.saveEntry("events", "launch", {
    data: { ...data, published: "not-a-date" },
    body: "",
    format: "toml",
  });

  expect(store.content(path)).toContain('published = "not-a-date"\n');
});

it("restores dates in an untyped TOML file collection", async () => {
  const store = new ContainerStorage(storageOptions(tomlFileCollections));

  store.file = { content: "[launch]\npublished = 2026-01-01\n", version: "v1" };

  const read = await store.getEntry("events", "launch");
  const data = overJson(read.data);

  await store.saveEntry("events", "launch", { data, body: "", format: "toml" });

  expect(store.file.content).toContain("published = 2026-01-01\n");
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
