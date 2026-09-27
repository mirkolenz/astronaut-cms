import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discardChanges, readChanges } from "@server/storage/git-changes";

// The local backend derives its changeset from `git status`, which collapses a
// directory git has never seen into a single `dir/` record. That record names no
// file, so it can neither be shown nor deleted — which is what these pin down:
// every pending file is listed by name, and discarding restores all of them.

const managed = ["src/content", "src/assets"];

let rootDir: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: rootDir });
}

function write(path: string, content: string): void {
  const full = join(rootDir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), "astronaut-cms-git-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write("src/content/post.md", "committed\n");
  git("add", "-A");
  git("commit", "-qm", "initial");
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("git-backed changeset", () => {
  it("names every pending file and discards them all", async () => {
    write("src/content/post.md", "edited\n");
    write("src/content/new.md", "added\n");
    // A directory git has never seen, the case that used to collapse.
    write("src/assets/gallery/photo.svg", "<svg />\n");

    const changes = await readChanges(rootDir, managed);

    expect(changes.map((change) => `${change.path} ${change.kind}`).sort()).toEqual([
      "src/assets/gallery/photo.svg added",
      "src/content/new.md added",
      "src/content/post.md modified",
    ]);

    await discardChanges(rootDir, managed);

    expect(await readChanges(rootDir, managed)).toEqual([]);
    expect(readFileSync(join(rootDir, "src/content/post.md"), "utf-8")).toBe("committed\n");
    expect(existsSync(join(rootDir, "src/assets/gallery/photo.svg"))).toBe(false);
  });

  it("restores a deleted file and leaves unmanaged paths alone", async () => {
    rmSync(join(rootDir, "src/content/post.md"));
    write("src/other.md", "not the CMS's\n");

    expect(await readChanges(rootDir, managed)).toMatchObject([
      { path: "src/content/post.md", kind: "deleted" },
    ]);

    await discardChanges(rootDir, managed);

    expect(existsSync(join(rootDir, "src/content/post.md"))).toBe(true);
    expect(existsSync(join(rootDir, "src/other.md"))).toBe(true);
  });
});
