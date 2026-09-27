import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "@/server/storage/local";
import { StaleWriteError } from "@/server/storage/types";
import { StubStorage, storageOptions } from "./fixtures/storage";
import type { CollectionManifest } from "@/shared/types";

// A concrete StorageBase that exposes the protected path helpers, so we can pin
// that glob-collection storage paths come from the loader's `base`
// (content.config.ts) rather than being hard-coded from the collection key.
class TestStorage extends StubStorage {
  collectionPath(collection: string) {
    return this.getCollectionPath(collection);
  }
  entryPath(collection: string, id: string, format: string) {
    return this.getEntryPath(collection, id, format);
  }
  entries(collection: string, paths: string[]) {
    return this.entriesFromTreePaths(collection, paths);
  }
}

class TestLocalStorage extends LocalStorage {
  move(from: string, to: string) {
    return this.moveMedia(from, to);
  }
}

const glob = {
  type: "content",
  loaderType: "glob",
  schema: null,
  loaderPattern: null,
  loaderFileName: null,
  sort: "id",
} as const;

const schemas: CollectionManifest = {
  // Collection key ("posts") differs from its directory ("blog").
  posts: { name: "posts", ...glob, loaderBase: "src/content/blog" },
  // No base captured -> conventional fallback.
  notes: { name: "notes", ...glob, loaderBase: null },
};

describe("StorageBase glob paths", () => {
  const storage = new TestStorage(storageOptions(schemas));

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
    expect(entries.map((entry) => entry.id)).toEqual(["a", "nested/b"]);
  });

  it("falls back to src/content/<name> when no base is captured", () => {
    expect(storage.collectionPath("notes")).toBe("src/content/notes");
  });
});

const MEDIA_DIRECTORY = "src/assets";

/** A throwaway project tree, removed however the test ends. */
async function inProject(run: (parent: string) => Promise<void>): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "astronaut-cms-storage-"));

  try {
    await run(parent);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

const localOptions = { ...storageOptions({}), mediaDirectory: MEDIA_DIRECTORY };

describe("LocalStorage paths", () => {
  it("refuses a symlink that leaves a managed directory", async () => {
    await inProject(async (parent) => {
      const rootDir = join(parent, "project");

      await mkdir(join(rootDir, MEDIA_DIRECTORY), { recursive: true });
      await writeFile(join(parent, "secret"), "private");
      await symlink(join(parent, "secret"), join(rootDir, MEDIA_DIRECTORY, "secret.png"));

      const storage = new LocalStorage({ rootDir }, localOptions);

      await expect(storage.readMedia("secret.png")).rejects.toThrow(/managed directory/);
      await expect(
        storage.uploadMedia("secret.png", new TextEncoder().encode("overwrite"), true),
      ).rejects.toThrow(/managed directory/);
      await expect(readFile(join(parent, "secret"), "utf8")).resolves.toBe("private");
    });
  });

  it("does not overwrite the destination of a media move", async () => {
    await inProject(async (parent) => {
      const source = join(parent, MEDIA_DIRECTORY, "source.png");
      const target = join(parent, MEDIA_DIRECTORY, "target.png");

      await mkdir(join(parent, MEDIA_DIRECTORY), { recursive: true });
      await writeFile(source, "source");
      await writeFile(target, "target");

      const storage = new TestLocalStorage({ rootDir: parent }, localOptions);

      await expect(
        storage.move(`${MEDIA_DIRECTORY}/source.png`, `${MEDIA_DIRECTORY}/target.png`),
      ).rejects.toBeInstanceOf(StaleWriteError);
      await expect(readFile(source, "utf8")).resolves.toBe("source");
      await expect(readFile(target, "utf8")).resolves.toBe("target");
    });
  });
});
