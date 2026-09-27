/**
 * The working tree as a storage backend, used by `astro dev`.
 *
 * It is a peer of the Git backends rather than a separate API: the same
 * operations reach it, validated the same way, so nothing above the storage
 * layer knows which one it is talking to. Writes are bounded to the paths the
 * CMS manages, so a crafted entry id or media path cannot reach the developer's
 * own files.
 *
 * Node-only. The integration substitutes a stub for it in any build that is not
 * a dev run, so `node:fs` never enters a Workers or edge bundle.
 */
import { link, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "pathe";
import type { EntryMeta, FileChange, MediaFile } from "../../shared/types.ts";
import { StorageBase, type StorageOptions } from "./base.ts";
import type { BranchStatus, MediaContent, VersionedContent } from "./types.ts";
import { getErrorCode, staleWrite, type Precondition } from "./types.ts";
import { discardChanges, managedPaths, readChanges } from "./git-changes.ts";
import { assertWithinBase, isWithin } from "./paths.ts";

export interface LocalConfig {
  /** Absolute project root. Every managed path is resolved against it. */
  rootDir: string;
}

export class LocalStorage extends StorageBase {
  private readonly rootDir: string;
  private readonly managed: string[];
  /** The roots as the filesystem actually names them. Fixed, so resolved once. */
  private canonicalRoots?: Promise<{ root: string; managed: Map<string, string> }>;

  constructor(config: LocalConfig, options: StorageOptions) {
    super(options);
    this.rootDir = config.rootDir;
    this.managed = managedPaths({
      rootDir: config.rootDir,
      mediaDir: join(config.rootDir, options.mediaDirectory),
      collections: options.collections,
    });
  }

  private roots(): Promise<{ root: string; managed: Map<string, string> }> {
    this.canonicalRoots ??= (async () => {
      const [root, managed] = await Promise.all([
        canonical(this.rootDir),
        Promise.all(
          this.managed.map(async (dir): Promise<[string, string]> => {
            const absolute = join(this.rootDir, dir);

            return [absolute, await canonical(absolute)];
          }),
        ),
      ]);

      return { root, managed: new Map(managed) };
    })();

    return this.canonicalRoots;
  }

  /**
   * A project-relative path lowered to an absolute one the CMS is allowed to
   * touch. Joining first means a crafted `..` cannot smuggle a path out of the
   * project, and the allowlist then bounds it to the content model.
   */
  private async resolve(path: string): Promise<string> {
    const fullPath = join(this.rootDir, path);

    assertWithinBase(fullPath, this.rootDir);

    const { root, managed } = await this.roots();
    const actualManagedRoot = [...managed].find(([absolute]) => isWithin(fullPath, absolute))?.[1];

    if (actualManagedRoot === undefined) {
      throw new Error(`Path is not managed by the CMS: ${path}`);
    }

    if (
      !isWithin(actualManagedRoot, root) ||
      !isWithin(await canonical(fullPath), actualManagedRoot)
    ) {
      throw new Error(`Path escapes the managed directory: ${path}`);
    }

    return fullPath;
  }

  /** Every file below a managed directory, project-relative, with its size. */
  private async listDirectory(dir: string): Promise<MediaFile[]> {
    let entries;

    try {
      entries = await readdir(await this.resolve(dir), { withFileTypes: true });
    } catch {
      return [];
    }

    const found = await Promise.all(
      entries.map(async (entry): Promise<MediaFile[]> => {
        const fullPath = join(entry.parentPath, entry.name);
        const path = relative(this.rootDir, fullPath);

        if (entry.isDirectory()) return this.listDirectory(path);

        const { size } = await stat(await this.resolve(path));

        return [{ path, size }];
      }),
    );

    return found.flat();
  }

  private async writeFileAt(
    path: string,
    content: string | Uint8Array,
    createOnly = false,
  ): Promise<void> {
    const fullPath = await this.resolve(path);

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, createOnly ? { flag: "wx" } : undefined);
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (this.isFileCollection(collection)) return this.listFileCollectionEntries(collection);

    const files = await this.listDirectory(this.getCollectionPath(collection));

    return this.entriesFromTreePaths(
      collection,
      files.map((file) => file.path),
    );
  }

  protected async fetchFileContent(path: string): Promise<VersionedContent> {
    const content = await readFile(await this.resolve(path), "utf-8");

    return { content, version: await digest(content) };
  }

  protected async fetchRawEntry(
    collection: string,
    id: string,
    ext: string,
  ): Promise<VersionedContent> {
    return this.fetchFileContent(this.getEntryPath(collection, id, ext));
  }

  /**
   * The working tree has nothing that names a file's state, so the state is
   * named by its contents. A dev run is one editor, but the assistant writes
   * here too, and the check being exercised in development is how it is known to
   * work in production.
   */
  protected async commitFile(
    path: string,
    content: string,
    _message?: string,
    precondition?: Precondition,
  ): Promise<string> {
    const absent = precondition !== undefined && "absent" in precondition;

    if (precondition !== undefined && !absent) await this.assertVersion(path, precondition.version);

    try {
      // `wx` is the claim itself: the check and the write are the same syscall,
      // so nothing can take the path in between.
      await this.writeFileAt(path, content, absent);
    } catch (error) {
      if (absent && getErrorCode(error) === "EEXIST") throw staleWrite(path);

      throw error;
    }

    return digest(content);
  }

  protected async removeFile(
    path: string,
    _message?: string,
    expectedVersion?: string,
  ): Promise<void> {
    if (expectedVersion !== undefined) await this.assertVersion(path, expectedVersion);

    await rm(await this.resolve(path), { force: true });
  }

  /** The working tree names a file's state by its contents, so this reads them back. */
  private async assertVersion(path: string, expectedVersion: string): Promise<void> {
    const current = await this.fetchFileContent(path).catch(() => null);

    if (current?.version !== expectedVersion) throw staleWrite(path);
  }

  async listMedia(): Promise<MediaFile[]> {
    return this.mediaFiles(await this.listDirectory(this.mediaDirectory));
  }

  protected async writeMedia(repoPath: string, bytes: Uint8Array): Promise<void> {
    await this.writeFileAt(repoPath, bytes);
  }

  protected async moveMedia(from: string, to: string): Promise<void> {
    const source = await this.resolve(from);
    const target = await this.resolve(to);

    await mkdir(dirname(target), { recursive: true });

    try {
      await link(source, target);
    } catch (error) {
      if (getErrorCode(error) === "EEXIST") throw staleWrite(to);

      throw error;
    }

    await rm(source);
  }

  protected async removeMedia(repoPath: string): Promise<void> {
    await this.removeFile(repoPath);
  }

  async readMedia(path: string): Promise<MediaContent> {
    const bytes = await readFile(await this.resolve(this.mediaRepoPath(path)));

    return {
      body: new Uint8Array(bytes),
      contentType: this.contentTypeOf(path),
      version: await digest(bytes),
    };
  }

  // Nothing to publish into: the working tree is the published state. Discard is
  // still meaningful, and is git restoring the files the CMS manages.
  async publish(): Promise<void> {}
  async update(): Promise<void> {}

  async discard(): Promise<void> {
    await discardChanges(this.rootDir, this.managed);
  }

  async getStatus(): Promise<BranchStatus> {
    return { branch: "", behind: 0 };
  }

  async getChanges(): Promise<FileChange[]> {
    return readChanges(this.rootDir, this.managed);
  }
}

/** Resolves every existing segment and preserves the missing tail of a new path. */
async function canonical(path: string): Promise<string> {
  const tail: string[] = [];
  let existing = path;

  for (;;) {
    try {
      return join(await realpath(existing), ...tail);
    } catch (err) {
      if (getErrorCode(err) !== "ENOENT") throw err;

      const parent = dirname(existing);

      if (parent === existing) throw err;

      tail.unshift(basename(existing));
      existing = parent;
    }
  }
}

/** A file's contents, named. Not a git hash: nothing here compares it to one. */
async function digest(content: string | Uint8Array): Promise<string> {
  const input = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hashed = await crypto.subtle.digest("SHA-256", input as BufferSource);

  return Array.from(new Uint8Array(hashed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
