import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "@/server/storage/local";
import { StaleWriteError } from "@/server/storage/types";
import { storageOptions } from "./fixtures/storage";

class TestLocalStorage extends LocalStorage {
  move(from: string, to: string) {
    return this.moveMedia(from, to);
  }
}

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

// The fixture's library is rooted at MEDIA_DIRECTORY already.
const localOptions = storageOptions({});

describe("LocalStorage paths", () => {
  it("does not report an escaped managed directory as an empty listing", async () => {
    await inProject(async (parent) => {
      const rootDir = join(parent, "project");

      await mkdir(join(rootDir, "src"), { recursive: true });
      await mkdir(join(parent, "outside"));
      await symlink(join(parent, "outside"), join(rootDir, MEDIA_DIRECTORY));

      const storage = new LocalStorage({ rootDir }, localOptions);

      await expect(storage.listMedia()).rejects.toThrow(/managed directory/);
    });
  });

  it("does not replace an existing file on upload", async () => {
    await inProject(async (parent) => {
      const target = join(parent, MEDIA_DIRECTORY, "target.png");

      await mkdir(join(parent, MEDIA_DIRECTORY), { recursive: true });
      await writeFile(target, "existing");

      const storage = new LocalStorage({ rootDir: parent }, localOptions);

      await expect(
        storage.uploadMedia("target.png", new TextEncoder().encode("new"), false),
      ).rejects.toThrow(/already exists/);
      await expect(readFile(target, "utf8")).resolves.toBe("existing");
    });
  });

  it("refuses hidden and disallowed repository media paths", async () => {
    await inProject(async (parent) => {
      const source = join(parent, MEDIA_DIRECTORY, "source.png");
      const hidden = join(parent, MEDIA_DIRECTORY, ".hidden.png");

      await mkdir(join(parent, MEDIA_DIRECTORY), { recursive: true });
      await writeFile(source, "source");
      await writeFile(hidden, "hidden");

      const storage = new LocalStorage({ rootDir: parent }, localOptions);

      await expect(storage.readMedia(".hidden.png")).rejects.toThrow(/hidden/);
      await expect(storage.renameMedia("source.png", "target.jpg")).rejects.toThrow(/allowed media type/);
      await expect(readFile(source, "utf8")).resolves.toBe("source");
    });
  });

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
