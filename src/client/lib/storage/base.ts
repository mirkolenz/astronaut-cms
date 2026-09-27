import { join } from "pathe";
import type {
  BranchStatus,
  ChangeRequestSummary,
  PublishMode,
  StorageBackend,
  StorageCapabilities,
} from "./types";
import { mapMergeError } from "./types";
import { getToken } from "./utils";
import type {
  CollectionManifest,
  EntryMeta,
  EntryContent,
  SaveEntryRequest,
  MediaFile,
  FileEntryLayout,
  CONTENT_FORMATS,
  DATA_FORMATS,
} from "@shared/types";
import { ALL_FORMATS, collectionBase, type FileChange } from "@shared/types";
import {
  parseContent,
  parseMultiEntryFile,
  serializeMultiEntryFile,
  getFileExtension,
} from "@shared/content-parser";
import config from "virtual:astronaut-cms/config";
import { validateSegment, validatePath, validateFormat, validateMediaPath } from "@shared/validation";
import { assertEntryWritable, type ContentSource, type MediaSource } from "@client/lib/validation";
import { assertWithinSizeLimit, hasAllowedExtension } from "@shared/media";
import { stripExtension, stripMediaPrefix } from "./utils";

const BRANCH_PREFIX = "cms/";

/**
 * A Git storage backend is also the repository media library: media there is
 * committed to the same draft branch as content. When the library lives
 * elsewhere, {@link useMediaSource} points entry validation at it instead.
 */
export abstract class StorageBase implements StorageBackend {
  abstract readonly capabilities: StorageCapabilities;

  protected schemas: CollectionManifest;
  protected mediaDirectory: string;
  private mediaSource: MediaSource = this;

  constructor(schemas: CollectionManifest, mediaDirectory: string) {
    this.schemas = schemas;
    this.mediaDirectory = mediaDirectory;
  }

  /** Only the listing is needed, so this never grants writes to a library it does not own. */
  useMediaSource(source: MediaSource): void {
    this.mediaSource = source;
  }

  abstract listEntries(collection: string): Promise<EntryMeta[]>;
  abstract listMedia(): Promise<MediaFile[]>;
  /**
   * All three take repository paths, lowered by the funnels below, and persist a
   * write the library's limits have already been checked against.
   */
  protected abstract writeMedia(repoPath: string, file: File): Promise<void>;
  protected abstract moveMedia(from: string, to: string): Promise<void>;
  protected abstract removeMedia(repoPath: string): Promise<void>;
  /** Persists an entry that has already been validated. */
  protected abstract writeEntry(
    collection: string,
    id: string,
    data: SaveEntryRequest,
  ): Promise<void>;
  abstract deleteEntry(collection: string, id: string): Promise<void>;
  abstract reorderEntries(collection: string, ids: string[]): Promise<void>;

  abstract publish(): Promise<void>;
  abstract update(): Promise<void>;
  abstract discard(): Promise<void>;
  abstract getStatus(): Promise<BranchStatus>;
  abstract getChanges(): Promise<FileChange[]>;

  /**
   * The single funnel for content writes, and therefore where content validity is
   * enforced: an entry that does not satisfy its collection's schema (or points
   * at an asset or reference that does not exist) breaks the site's content sync,
   * so it never reaches storage. Every other write composes this one.
   */
  async saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<void> {
    const col = this.schemas[collection];

    if (!col) throw new Error(`Unknown collection: ${collection}`);

    await assertEntryWritable(this.contentSource, { col, id, ...data });
    await this.writeEntry(collection, id, data);
  }

  async getEntry(collection: string, id: string, format?: string): Promise<EntryContent> {
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

    const known: readonly string[] =
      col.type === "content"
        ? (["md", "mdx", "mdoc"] satisfies Array<(typeof CONTENT_FORMATS)[number]>)
        : (["json", "yaml", "yml", "toml"] satisfies Array<(typeof DATA_FORMATS)[number]>);

    // A caller that listed the entry already knows its format; trying that first
    // turns the fallback loop's 404s into a single request.
    const extensions = format ? [format, ...known.filter((ext) => ext !== format)] : known;

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

  /** What entry validation resolves references and assets against. */
  protected get contentSource(): ContentSource {
    return {
      listEntries: (collection) => this.listEntries(collection),
      listMedia: () => this.mediaSource.listMedia(),
    };
  }

  // --- Repository media library ---

  /** The repository path of a library file. */
  protected mediaRepoPath(path: string): string {
    validateMediaPath(path);

    return join(this.mediaDirectory, path);
  }

  /** Where a repository library's own writes are checked, before any path is built. */
  async uploadMedia(path: string, file: File, overwrite = false): Promise<void> {
    assertWithinSizeLimit(file.size, config.maxFileSize);

    // Replacing a file is a different act from adding one, and the same rule the
    // media route enforces for an object store holds here: an upload that did not
    // ask to replace does not get to. A commit is reviewable where an object
    // write is not, which changes the stakes, not the rule.
    if (!overwrite && (await this.listMedia()).some((entry) => entry.path === path)) {
      throw new Error(`A file already exists at "${path}".`);
    }

    return this.writeMedia(this.mediaRepoPath(path), file);
  }

  async renameMedia(oldPath: string, newPath: string): Promise<void> {
    return this.moveMedia(this.mediaRepoPath(oldPath), this.mediaRepoPath(newPath));
  }

  async deleteMedia(path: string): Promise<void> {
    return this.removeMedia(this.mediaRepoPath(path));
  }

  /**
   * The dev server serves the working tree directly; the Git backends override
   * this. Addressed by the file's own location rather than by `mediaRef`, which
   * spells a *reference* and reports a bare key for a library standing in for an
   * object store.
   */
  async readUrl(path: string): Promise<string | Blob> {
    return join(import.meta.env.BASE_URL, this.mediaDirectory, path);
  }

  /**
   * Lowers repository paths into library files, dropping strays in the media
   * directory. Takes the backend's own listing shape rather than `MediaFile`s, so
   * a whole-repository tree costs no allocation for the paths it discards.
   */
  protected mediaFiles(files: Iterable<{ path: string; size?: number }>): MediaFile[] {
    const result: MediaFile[] = [];

    for (const file of files) {
      const path = stripMediaPrefix(file.path, this.mediaDirectory);

      if (path != null && hasAllowedExtension(path, config.mediaExtensions)) {
        result.push({ path, size: file.size ?? 0 });
      }
    }

    return result;
  }

  // --- File collection helpers ---

  protected isFileCollection(collection: string): boolean {
    return this.schemas[collection]?.loaderType === "file";
  }

  protected getFileLoaderPath(collection: string): string | null {
    return this.schemas[collection]?.loaderFileName ?? null;
  }

  /** How a file collection stores its entries, which decides whether they can be reordered. */
  async getFileLayout(collection: string): Promise<FileEntryLayout> {
    const loaderFileName = this.getFileLoaderPath(collection);

    if (!loaderFileName) return "object";

    try {
      const raw = await this.fetchFileContent(loaderFileName);

      return parseMultiEntryFile(raw, getFileExtension(loaderFileName) || "json").layout;
    } catch {
      return "object";
    }
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

  protected getCollectionPath(collection: string): string {
    return collectionBase(collection, this.schemas[collection]);
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
 * How long a branch lookup is trusted before it is made again. The branch can be
 * retired without this session doing anything — a reviewer merging the pull
 * request and deleting the source branch — and the admin stays open far longer
 * than that, so the cache expires rather than living until the next reload.
 */
const BRANCH_TTL = 60_000;

/**
 * Shared lifecycle for backends that commit to a per-user branch (cms/<username>)
 * and integrate it into a default branch via a pull/merge request. Caches the
 * resolved branch name and its existence; both are invalidated on token change,
 * the latter also by its own age and by explicit creation/deletion via
 * markBranchExists.
 */
export abstract class BranchedStorage extends StorageBase {
  readonly capabilities: StorageCapabilities = { publish: true, update: true };

  private userBranch: string | null = null;
  private cacheToken: string | null = null;
  private branchExistsCache: { value: boolean; at: number } | null = null;

  protected publishMode: PublishMode;

  constructor(schemas: CollectionManifest, mediaDirectory: string, publishMode: PublishMode) {
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
  protected abstract computeBehind(branch: string): Promise<number>;
  /** Files the draft branch changes relative to the default branch. */
  protected abstract diffAgainstDefault(branch: string): Promise<FileChange[]>;

  protected changeRequestTitle(branch: string): string {
    return `CMS draft (${branch})`;
  }

  protected changeRequestBody(branch: string): string {
    return `Opened automatically by Astronaut CMS. Delete the \`${branch}\` branch to discard all pending changes.`;
  }

  protected markBranchExists(exists: boolean): void {
    this.branchExistsCache = { value: exists, at: Date.now() };
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
    const cached = this.branchExistsCache;

    if (cached && Date.now() - cached.at < BRANCH_TTL) return cached.value;

    const value = await this.checkBranchExists(branch);

    this.markBranchExists(value);

    return value;
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

    await this.dropBranch(branch);
  }

  async update(): Promise<void> {
    const branch = await this.getUserBranch();
    if (!(await this.branchExists(branch))) return;
    await this.doUpdate(branch);
  }

  async discard(): Promise<void> {
    const branch = await this.getUserBranch();

    if (!(await this.branchExists(branch))) return;

    await this.dropBranch(branch);
  }

  /**
   * Retires the draft branch and any change request on it, which is what both
   * discarding a changeset and publishing one come down to. Publishing has to
   * ask for it too: only GitLab removes the source branch as part of accepting,
   * so without this the branch would outlive the changeset on GitHub while the
   * cache reported it gone, and the next write would try to create it afresh.
   */
  private async dropBranch(branch: string): Promise<void> {
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
      // Already gone (e.g. removed along with the merge).
    }

    this.markBranchExists(false);
  }

  // The draft branch is the changeset: everything on it is pending, and publish
  // and discard act on all of it at once.
  async getChanges(): Promise<FileChange[]> {
    const branch = await this.getUserBranch();

    return (await this.branchExists(branch)) ? this.diffAgainstDefault(branch) : [];
  }

  async getStatus(): Promise<BranchStatus> {
    const branch = await this.getUserBranch();
    if (!(await this.branchExists(branch))) {
      return { branch: "", behind: 0 };
    }
    const status: BranchStatus = { branch, behind: await this.computeBehind(branch) };
    if (this.publishMode === "pull-request") {
      const cr = await this.findOpenChangeRequest(branch);
      if (cr) status.changeRequestUrl = cr.url;
    }
    return status;
  }
}
