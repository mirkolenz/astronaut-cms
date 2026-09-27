import type { BranchStatus, ChangeRequestSummary, PublishMode, StorageBackend } from "./types";
import { mapMergeError } from "./types";
import { getToken } from "./utils";
import type {
  CollectionInfo,
  EntryMeta,
  EntryContent,
  SaveEntryRequest,
  MediaFile,
  FileEntryLayout,
  CONTENT_FORMATS,
  DATA_FORMATS,
} from "@shared/types";
import { ALL_FORMATS } from "@shared/types";
import {
  parseContent,
  parseMultiEntryFile,
  serializeMultiEntryFile,
  getFileExtension,
} from "@shared/content-parser";
import { validateSegment, validatePath, validateFormat } from "@shared/validation";
import { stripExtension } from "./utils";

const BRANCH_PREFIX = "cms/";

export abstract class StorageBase implements StorageBackend {
  protected schemas: Record<string, CollectionInfo>;
  protected mediaDirectory: string;

  constructor(schemas: Record<string, CollectionInfo>, mediaDirectory: string) {
    this.schemas = schemas;
    this.mediaDirectory = mediaDirectory;
  }

  abstract listEntries(collection: string): Promise<EntryMeta[]>;
  abstract listMedia(): Promise<MediaFile[]>;
  abstract uploadMedia(path: string, file: File): Promise<MediaFile>;
  abstract replaceMedia(path: string, file: File): Promise<MediaFile>;
  abstract renameMedia(oldPath: string, newPath: string): Promise<MediaFile>;
  abstract deleteMedia(path: string): Promise<void>;
  abstract saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<void>;
  abstract deleteEntry(collection: string, id: string): Promise<void>;
  abstract reorderEntries(collection: string, ids: string[]): Promise<void>;

  abstract publish(): Promise<void>;
  abstract update(): Promise<void>;
  abstract discard(): Promise<void>;
  abstract getStatus(): Promise<BranchStatus>;

  async getEntry(collection: string, id: string): Promise<EntryContent> {
    const col = this.schemas[collection];
    if (!col) throw new Error(`Unknown collection: ${collection}`);

    if (col.loaderType === "file" && col.loaderFileName) {
      const format = getFileExtension(col.loaderFileName) || "json";
      const raw = await this.fetchFileContent(col.loaderFileName);
      const { entries } = parseMultiEntryFile(raw, format);
      const entry = entries[id];
      if (!entry) throw new Error(`Entry not found: ${collection}/${id}`);
      return { id, data: entry, body: "", format };
    }

    const extensions: readonly string[] =
      col.type === "content"
        ? (["md", "mdx", "mdoc"] satisfies Array<(typeof CONTENT_FORMATS)[number]>)
        : (["json", "yaml", "yml", "toml"] satisfies Array<(typeof DATA_FORMATS)[number]>);

    for (const ext of extensions) {
      try {
        const raw = await this.fetchRawEntry(collection, id, ext);
        const { data, body } = parseContent(raw, ext);
        return { id, data, body, format: ext };
      } catch {
        continue;
      }
    }

    throw new Error(`Entry not found: ${collection}/${id}`);
  }

  // Rename and duplicate compose the storage primitives, so they work uniformly
  // for glob and file collections (saveEntry/deleteEntry already branch on layout).
  async duplicateEntry(collection: string, sourceId: string, targetId: string): Promise<void> {
    const [source, targetExists] = await Promise.all([
      this.getEntry(collection, sourceId),
      this.entryExists(collection, targetId),
    ]);

    if (targetExists) {
      throw new Error(`Entry already exists: ${collection}/${targetId}`);
    }

    await this.saveEntry(collection, targetId, {
      data: source.data,
      body: source.body,
      format: source.format,
    });
  }

  async renameEntry(collection: string, oldId: string, newId: string): Promise<void> {
    if (oldId === newId) return;

    await this.duplicateEntry(collection, oldId, newId);
    await this.deleteEntry(collection, oldId);
  }

  private async entryExists(collection: string, id: string): Promise<boolean> {
    try {
      await this.getEntry(collection, id);

      return true;
    } catch {
      return false;
    }
  }

  protected async fetchRawEntry(_collection: string, _id: string, _ext: string): Promise<string> {
    throw new Error("Not implemented");
  }

  /**
   * Fetches the raw content of a file by path.
   * Subclasses that support file() collections must override this.
   */
  protected async fetchFileContent(_path: string): Promise<string> {
    throw new Error("Not implemented");
  }

  // --- File collection helpers ---

  protected isFileCollection(collection: string): boolean {
    return this.schemas[collection]?.loaderType === "file";
  }

  protected getFileLoaderPath(collection: string): string | null {
    return this.schemas[collection]?.loaderFileName ?? null;
  }

  protected async listFileCollectionEntries(collection: string): Promise<EntryMeta[]> {
    const loaderFileName = this.getFileLoaderPath(collection);
    if (!loaderFileName) return [];
    const format = getFileExtension(loaderFileName) || "json";
    try {
      const raw = await this.fetchFileContent(loaderFileName);
      const { entries } = parseMultiEntryFile(raw, format);
      return Object.keys(entries).map((id) => ({ id, collection, format }));
    } catch {
      return [];
    }
  }

  protected async upsertFileCollectionEntry(
    collection: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<{ path: string; content: string }> {
    const loaderFileName = this.getFileLoaderPath(collection)!;
    const format = getFileExtension(loaderFileName) || "json";

    let entries: Record<string, Record<string, unknown>> = {};
    let layout: FileEntryLayout = "object";
    try {
      const raw = await this.fetchFileContent(loaderFileName);
      const parsed = parseMultiEntryFile(raw, format);
      entries = parsed.entries;
      layout = parsed.layout;
    } catch {
      // File doesn't exist yet — start with an empty map.
    }

    entries[id] = data;
    const content = serializeMultiEntryFile(entries, format, layout);
    return { path: loaderFileName, content };
  }

  protected async removeFileCollectionEntry(
    collection: string,
    id: string,
  ): Promise<{ path: string; content: string }> {
    const loaderFileName = this.getFileLoaderPath(collection)!;
    const format = getFileExtension(loaderFileName) || "json";
    const raw = await this.fetchFileContent(loaderFileName);
    const { entries, layout } = parseMultiEntryFile(raw, format);
    delete entries[id];
    const content = serializeMultiEntryFile(entries, format, layout);
    return { path: loaderFileName, content };
  }

  protected async buildReorderedFileCollection(
    collection: string,
    ids: string[],
  ): Promise<{ path: string; content: string }> {
    const loaderFileName = this.getFileLoaderPath(collection)!;
    const format = getFileExtension(loaderFileName) || "json";
    const raw = await this.fetchFileContent(loaderFileName);
    const { entries, layout } = parseMultiEntryFile(raw, format);
    const reordered: Record<string, Record<string, unknown>> = {};
    for (const id of ids) {
      if (id in entries) reordered[id] = entries[id];
    }
    for (const id of Object.keys(entries)) {
      if (!(id in reordered)) reordered[id] = entries[id];
    }
    const content = serializeMultiEntryFile(reordered, format, layout);
    return { path: loaderFileName, content };
  }

  // --- Glob collection helpers ---

  // Glob collections live at their loader's configured `base` (from
  // content.config.ts), not necessarily a directory named after the collection.
  // Fall back to the conventional location when no base was captured.
  protected getCollectionPath(collection: string): string {
    return this.schemas[collection]?.loaderBase ?? `src/content/${collection}`;
  }

  protected getEntryPath(collection: string, entryId: string, format: string): string {
    validateSegment(collection, "collection");
    validatePath(entryId, "entryId");
    validateFormat(format);
    return `${this.getCollectionPath(collection)}/${entryId}.${format}`;
  }

  /**
   * Filters and maps repository tree paths into entry metadata. Subclasses
   * fetch the recursive tree from their SDK and pass the paths through.
   */
  protected entriesFromTreePaths(collection: string, paths: Iterable<string>): EntryMeta[] {
    const prefix = `${this.getCollectionPath(collection)}/`;
    const result: EntryMeta[] = [];
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const ext = getFileExtension(path);
      if (!(ALL_FORMATS as readonly string[]).includes(ext)) continue;
      result.push({
        id: stripExtension(path.slice(prefix.length)),
        collection,
        format: ext,
      });
    }
    return result;
  }
}

/**
 * Shared lifecycle for backends that commit to a per-user branch (cms/<username>)
 * and integrate it into a default branch via a pull/merge request. Caches the
 * resolved branch name and its existence; both are invalidated on token change
 * and explicit branch creation/deletion via markBranchExists.
 */
export abstract class BranchedStorage extends StorageBase {
  private userBranch: string | null = null;
  private cacheToken: string | null = null;
  private branchExistsCache: boolean | null = null;

  protected publishMode: PublishMode;

  constructor(
    schemas: Record<string, CollectionInfo>,
    mediaDirectory: string,
    publishMode: PublishMode,
  ) {
    super(schemas, mediaDirectory);
    this.publishMode = publishMode;
  }

  protected abstract get defaultBranch(): string;
  protected abstract fetchUsername(): Promise<string>;
  protected abstract checkBranchExists(branch: string): Promise<boolean>;
  protected abstract findOpenChangeRequest(branch: string): Promise<ChangeRequestSummary | null>;
  protected abstract createChangeRequest(branch: string): Promise<ChangeRequestSummary>;
  protected abstract closeChangeRequest(id: number): Promise<void>;
  protected abstract acceptChangeRequest(request: ChangeRequestSummary): Promise<void>;
  protected abstract deleteUserBranch(branch: string): Promise<void>;
  protected abstract doUpdate(branch: string): Promise<void>;
  protected abstract computeAheadBehind(branch: string): Promise<{ ahead: number; behind: number }>;

  protected changeRequestTitle(branch: string): string {
    return `CMS draft (${branch})`;
  }

  protected changeRequestBody(branch: string): string {
    return `Opened automatically by Astronaut CMS. Delete the \`${branch}\` branch to discard all pending changes.`;
  }

  protected markBranchExists(exists: boolean): void {
    this.branchExistsCache = exists;
  }

  protected async getUserBranch(): Promise<string> {
    const currentToken = getToken();
    if (currentToken !== this.cacheToken) {
      this.userBranch = null;
      this.branchExistsCache = null;
      this.cacheToken = currentToken;
    }
    if (this.userBranch) return this.userBranch;
    this.userBranch = `${BRANCH_PREFIX}${await this.fetchUsername()}`;
    return this.userBranch;
  }

  protected async branchExists(branch: string): Promise<boolean> {
    if (this.branchExistsCache !== null) return this.branchExistsCache;
    this.branchExistsCache = await this.checkBranchExists(branch);
    return this.branchExistsCache;
  }

  protected async readRef(): Promise<string> {
    const branch = await this.getUserBranch();
    return (await this.branchExists(branch)) ? branch : this.defaultBranch;
  }

  protected async ensureChangeRequestOpen(branch: string): Promise<ChangeRequestSummary> {
    return (await this.findOpenChangeRequest(branch)) ?? (await this.createChangeRequest(branch));
  }

  async publish(): Promise<void> {
    const branch = await this.getUserBranch();
    if (!(await this.branchExists(branch))) return;
    const cr = await this.ensureChangeRequestOpen(branch);
    if (this.publishMode === "pull-request") return;
    try {
      await this.acceptChangeRequest(cr);
    } catch (err) {
      throw mapMergeError(err);
    }
    this.markBranchExists(false);
  }

  async update(): Promise<void> {
    const branch = await this.getUserBranch();
    if (!(await this.branchExists(branch))) return;
    await this.doUpdate(branch);
  }

  async discard(): Promise<void> {
    const branch = await this.getUserBranch();
    if (!(await this.branchExists(branch))) return;
    const cr = await this.findOpenChangeRequest(branch);
    if (cr) {
      try {
        await this.closeChangeRequest(cr.id);
      } catch {
        // Already closed.
      }
    }
    try {
      await this.deleteUserBranch(branch);
    } catch {
      // Already gone (e.g. PR merged with auto-delete).
    }
    this.markBranchExists(false);
  }

  async getStatus(): Promise<BranchStatus> {
    const branch = await this.getUserBranch();
    if (!(await this.branchExists(branch))) {
      return { hasBranch: false, branch, ahead: 0, behind: 0 };
    }
    const counts = await this.computeAheadBehind(branch);
    const status: BranchStatus = { hasBranch: true, branch, ...counts };
    if (this.publishMode === "pull-request") {
      const cr = await this.findOpenChangeRequest(branch);
      if (cr) status.changeRequestUrl = cr.url;
    }
    return status;
  }
}
