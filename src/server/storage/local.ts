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
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "pathe";
import type { EntryMeta, FileChange, MediaFile } from "../../shared/types.ts";
import { StorageBase, type StorageOptions } from "./base.ts";
import type { BranchStatus, MediaContent, VersionedContent } from "./types.ts";
import { staleWrite } from "./types.ts";
import { discardChanges, managedPaths, readChanges } from "./git-changes.ts";
import { assertWithinBase, isWithin } from "./paths.ts";

export interface LocalConfig {
  /** Absolute project root. Every managed path is resolved against it. */
  rootDir: string;
}

export class LocalStorage extends StorageBase {
  private readonly rootDir: string;
  private readonly managed: string[];

  constructor(config: LocalConfig, options: StorageOptions) {
    super(options);
    this.rootDir = config.rootDir;
    this.managed = managedPaths({
      rootDir: config.rootDir,
      mediaDir: join(config.rootDir, options.mediaDirectory),
      collections: options.collections,
    });
  }

  /**
   * A project-relative path lowered to an absolute one the CMS is allowed to
   * touch. Joining first means a crafted `..` cannot smuggle a path out of the
   * project, and the allowlist then bounds it to the content model.
   */
  private resolve(path: string): string {
    const fullPath = join(this.rootDir, path);

    assertWithinBase(fullPath, this.rootDir);

    if (!this.managed.some((root) => isWithin(fullPath, join(this.rootDir, root)))) {
      throw new Error(`Path is not managed by the CMS: ${path}`);
    }

    return fullPath;
  }

  /** Every file below a managed directory, project-relative, with its size. */
  private async listDirectory(dir: string): Promise<MediaFile[]> {
    let entries;

    try {
      entries = await readdir(this.resolve(dir), { withFileTypes: true });
    } catch {
      return [];
    }

    const found = await Promise.all(
      entries.map(async (entry): Promise<MediaFile[]> => {
        const fullPath = join(entry.parentPath, entry.name);

        if (entry.isDirectory()) return this.listDirectory(relative(this.rootDir, fullPath));

        const { size } = await stat(fullPath);

        return [{ path: relative(this.rootDir, fullPath), size }];
      }),
    );

    return found.flat();
  }

  private async writeFileAt(path: string, content: string | Uint8Array): Promise<void> {
    const fullPath = this.resolve(path);

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
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
    const content = await readFile(this.resolve(path), "utf-8");

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
    expectedVersion?: string,
  ): Promise<string> {
    if (expectedVersion !== undefined) {
      const current = await this.fetchFileContent(path).catch(() => null);

      if (current?.version !== expectedVersion) throw staleWrite(path);
    }

    await this.writeFileAt(path, content);

    return digest(content);
  }

  protected async removeFile(
    path: string,
    _message?: string,
    expectedVersion?: string,
  ): Promise<void> {
    if (expectedVersion !== undefined) {
      const current = await this.fetchFileContent(path).catch(() => null);

      if (current?.version !== expectedVersion) throw staleWrite(path);
    }

    await rm(this.resolve(path), { force: true });
  }

  async listMedia(): Promise<MediaFile[]> {
    return this.mediaFiles(await this.listDirectory(this.mediaDirectory));
  }

  protected async writeMedia(repoPath: string, bytes: Uint8Array): Promise<void> {
    await this.writeFileAt(repoPath, bytes);
  }

  protected async moveMedia(from: string, to: string): Promise<void> {
    const target = this.resolve(to);

    await mkdir(dirname(target), { recursive: true });
    await rename(this.resolve(from), target);
  }

  protected async removeMedia(repoPath: string): Promise<void> {
    await this.removeFile(repoPath);
  }

  async readMedia(path: string): Promise<MediaContent> {
    const bytes = await readFile(this.resolve(this.mediaRepoPath(path)));

    return {
      bytes: new Uint8Array(bytes),
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

/** A file's contents, named. Not a git hash: nothing here compares it to one. */
async function digest(content: string | Uint8Array): Promise<string> {
  const input = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hashed = await crypto.subtle.digest("SHA-256", input as BufferSource);

  return Array.from(new Uint8Array(hashed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
