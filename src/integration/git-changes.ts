/**
 * Git-backed changeset for the local (dev) storage backend.
 *
 * The remote backends get their changeset for free: everything on the user's
 * draft branch is pending, and publishing merges it. Local storage writes
 * straight into the working tree, so the equivalent "what has changed since the
 * last commit" comes from git itself. Every command is scoped to the paths the
 * CMS manages (collection directories, file-collection files, the media
 * directory), so a discard can never touch the developer's source edits.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unlink } from "node:fs/promises";
import { join, relative } from "pathe";
import { collectionBase, type ChangeKind, type CollectionManifest, type FileChange } from "../shared/types.ts";
import { assertWithinBase } from "./paths.ts";

const run = promisify(execFile);

// Diffs of edited content are small; the ceiling only has to keep a pathological
// file (a committed binary, a generated data file) from being truncated mid-line.
const MAX_OUTPUT = 32 * 1024 * 1024;

async function git(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: rootDir, maxBuffer: MAX_OUTPUT });

  return stdout;
}

// `git diff` exits non-zero precisely when it found a difference, which for
// `--no-index` (used for untracked files) is the normal case.
async function gitDiff(rootDir: string, args: string[]): Promise<string | undefined> {
  try {
    return (await git(rootDir, args)) || undefined;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;

    return stdout || undefined;
  }
}

/**
 * The project's position inside the repository (`""` at its root), or null when
 * there is no repository. Porcelain paths are repository-relative while the rest
 * of the CMS is project-relative, so this prefix is what translates between them.
 */
async function repositoryPrefix(rootDir: string): Promise<string | null> {
  try {
    return (await git(rootDir, ["rev-parse", "--show-prefix"])).trim();
  } catch {
    return null;
  }
}

function toKind(status: string): ChangeKind {
  if (status.includes("?") || status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";

  return "modified";
}

interface StatusEntry {
  path: string;
  previousPath?: string;
  kind: ChangeKind;
  untracked: boolean;
}

/**
 * Parses `git status --porcelain=v1 -z`: NUL-terminated records of `XY <path>`,
 * where a rename record is followed by a second record holding the old path.
 * Paths are made project-relative by stripping the repository prefix.
 */
function parseStatus(stdout: string, prefix: string): StatusEntry[] {
  const records = stdout.split("\0").filter(Boolean);
  const entries: StatusEntry[] = [];
  const strip = (path: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : path);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const status = record.slice(0, 2);
    const renamed = status.includes("R");

    entries.push({
      path: strip(record.slice(3)),
      previousPath: renamed ? strip(records[++i]) : undefined,
      kind: toKind(status),
      untracked: status === "??",
    });
  }

  return entries;
}

async function readStatus(
  rootDir: string,
  paths: string[],
  prefix: string,
): Promise<StatusEntry[]> {
  if (paths.length === 0) return [];

  return parseStatus(await git(rootDir, ["status", "--porcelain=v1", "-z", "--", ...paths]), prefix);
}

async function toFileChange(rootDir: string, entry: StatusEntry): Promise<FileChange> {
  const patch = entry.untracked
    ? await gitDiff(rootDir, ["diff", "--no-index", "--", "/dev/null", entry.path])
    : await gitDiff(rootDir, ["diff", "HEAD", "--", entry.path]);

  return { path: entry.path, kind: entry.kind, previousPath: entry.previousPath, patch };
}

/** Working-tree changes to the managed paths, in the shape the git backends report. */
export async function readChanges(rootDir: string, paths: string[]): Promise<FileChange[]> {
  const prefix = await repositoryPrefix(rootDir);

  // Outside a repository there is no committed state to compare against, so
  // nothing counts as pending.
  if (prefix === null) return [];

  const entries = await readStatus(rootDir, paths, prefix);

  return Promise.all(entries.map((entry) => toFileChange(rootDir, entry)));
}

/** Restores every managed path to its committed state, deleting files that were newly added. */
export async function discardChanges(rootDir: string, paths: string[]): Promise<void> {
  const prefix = await repositoryPrefix(rootDir);

  if (prefix === null) return;

  const entries = await readStatus(rootDir, paths, prefix);
  const tracked = entries.filter((entry) => !entry.untracked);
  const untracked = entries.filter((entry) => entry.untracked);

  if (tracked.length > 0) {
    const restorable = tracked.flatMap((entry) =>
      entry.previousPath ? [entry.path, entry.previousPath] : [entry.path],
    );

    await git(rootDir, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...restorable]);
  }

  await Promise.all(
    untracked.map((entry) => {
      const filePath = join(rootDir, entry.path);
      assertWithinBase(filePath, rootDir);

      return unlink(filePath);
    }),
  );
}

/**
 * The project-relative paths the CMS owns: every collection's storage location
 * plus the media directory. Anything outside this set is the developer's, and no
 * CMS command may read or write it.
 */
export function managedPaths(options: {
  rootDir: string;
  mediaDir: string;
  collections?: CollectionManifest;
}): string[] {
  const { rootDir, mediaDir, collections } = options;
  const paths = new Set([relative(rootDir, mediaDir)]);

  for (const [name, collection] of Object.entries(collections ?? {})) {
    paths.add(collection.loaderFileName ?? collectionBase(name, collection));
  }

  return [...paths].filter(Boolean);
}
