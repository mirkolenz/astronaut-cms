import { join } from "pathe";
import type {
  BranchStatus,
  ChangeRequestSummary,
  MediaBackend,
  MediaContent,
  PublishMode,
  StorageBackend,
  UploadTicket,
} from "./types.ts";
import {
  isNotFound,
  mapMergeError,
  staleWrite,
  versioned,
  type Precondition,
  type VersionedContent,
} from "./types.ts";
import type {
  CollectionManifest,
  EntryMeta,
  EntryContent,
  EntryFormat,
  SaveEntryRequest,
  MediaFile,
  FileEntryLayout,
  FileCollectionInfo,
  FileChange,
  TrashedFile,
} from "../../shared/types.ts";
import {
  CONTENT_FORMATS,
  DATA_FORMATS,
  asEntryFormat,
  collectionBase,
} from "../../shared/types.ts";
import {
  parseContent,
  parseMultiEntryFile,
  serializeContent,
  serializeMultiEntryFile,
  getFileExtension,
} from "../../shared/content-parser.ts";
import {
  validateSegment,
  validatePath,
  validateFormat,
  validateMediaPath,
} from "../../shared/validation.ts";
import { assertEntryWritable, type ContentSource, type MediaSource } from "../validation.ts";
import {
  assertWithinSizeLimit,
  isLibraryFile,
  mediaContentType,
} from "../../shared/media.ts";
import { stripExtension, stripMediaPrefix } from "../../shared/paths.ts";
import { HttpError } from "../errors.ts";

const untrashable =
  "This library keeps its deletions in the changeset rather than a trash. Discard the pending changes to bring a deleted file back.";

const BRANCH_PREFIX = "cms/";

export function toBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

/** Both providers hand file contents back this way, whitespace and all. */
export function fromBase64(content: string): string {
  const binary = atob(content.replace(/\s/g, ""));

  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** A file collection's container, parsed. */
interface FileCollection {
  path: string;
  format: EntryFormat;
  entries: Record<string, Record<string, unknown>>;
  layout: FileEntryLayout;
  /** The container's version, which is every one of its entries' version too. */
  version?: string;
}

/** Everything a backend needs that is not the provider credential itself. */
export interface StorageOptions {
  collections: CollectionManifest;
  mediaDirectory: string;
  /** Extensions the library lists and accepts, already lower-cased. */
  mediaExtensions: string[] | null;
  maxFileSize: number | null;
  /** The signed-in editor, which is what the draft branch is named after. */
  login: string;
}

/**
 * A Git storage backend is also the repository media library: media there is
 * committed to the same draft branch as content. When the library lives
 * elsewhere, {@link useMediaSource} points entry validation at it instead.
 *
 * One instance serves one request. Nothing here is cached across requests, which
 * is what makes it correct on a serverless runtime where an instance may be
 * shared between editors or discarded between clicks.
 */
export abstract class StorageBase implements StorageBackend, MediaBackend {
  protected readonly options: StorageOptions;
  protected readonly schemas: CollectionManifest;
  protected readonly mediaDirectory: string;
  private mediaSource: MediaSource = this;

  /**
   * The container file of each file collection, read at most once per request.
   * Every entry of one lives in the same file, so a reference scan over an
   * N-entry collection would otherwise fetch and re-parse it N times.
   */
  private readonly containers = new Map<string, Promise<FileCollection>>();

  constructor(options: StorageOptions) {
    this.options = options;
    this.schemas = options.collections;
    this.mediaDirectory = options.mediaDirectory;
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
  protected abstract writeMedia(repoPath: string, bytes: Uint8Array): Promise<void>;
  protected abstract moveMedia(from: string, to: string): Promise<void>;
  protected abstract removeMedia(repoPath: string): Promise<void>;
  /** A content write, after which the container this request read is stale. */
  private async persist(
    path: string,
    content: string,
    message: string,
    precondition?: Precondition,
  ): Promise<string | undefined> {
    const version = await this.commitFile(path, content, message, precondition);

    this.containers.clear();

    return version;
  }

  /**
   * The two file primitives every content write comes down to. Which file and
   * what goes in it is decided here, uniformly, so a backend only has to know
   * how to persist one.
   *
   * The `precondition` is what the write requires of the path at the instant it
   * is claimed. A backend that can make the provider enforce it does; one that
   * cannot ignores it, and the write takes the last word as it always did.
   */
  protected abstract commitFile(
    path: string,
    content: string,
    message: string,
    precondition?: Precondition,
  ): Promise<string | undefined>;
  protected abstract removeFile(
    path: string,
    message: string,
    expectedVersion?: string,
  ): Promise<void>;

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
  async saveEntry(
    collection: string,
    id: string,
    data: SaveEntryRequest,
  ): Promise<string | undefined> {
    const col = this.schemas[collection];

    if (!col) throw new Error(`Unknown collection: ${collection}`);

    await assertEntryWritable(this.contentSource, { col, id, ...data });

    const edited = this.isFileCollection(collection)
      ? await this.editFileCollection(collection, (entries) => {
          if (data.createOnly && Object.hasOwn(entries, id)) {
            throw staleWrite(`${collection}/${id}`);
          }

          entries[id] = data.data;
        })
      : {
          path: this.getEntryPath(collection, id, data.format),
          content: serializeContent(data.data, data.body, data.format),
          version: undefined,
        };

    // A new entry claims its path by requiring it to be absent. In a file
    // collection the path is the container, which may well exist already — the
    // entry inside it is what has to be new, and the rewrite above checked that
    // — so the claim there is on the container's version instead.
    //
    // That version is only ever adopted for a new entry: an ordinary save of a
    // file collection carries the version the editor was given or none at all,
    // and none means last-write-wins, as it does everywhere else.
    const version = data.createOnly
      ? (data.expectedVersion ?? edited.version)
      : data.expectedVersion;
    const precondition: Precondition | undefined =
      version !== undefined ? { version } : data.createOnly ? { absent: true } : undefined;

    return this.persist(edited.path, edited.content, `Update ${collection}/${id}`, precondition);
  }

  async deleteEntry(collection: string, id: string, expectedVersion?: string): Promise<void> {
    const message = `Delete ${collection}/${id}`;

    if (this.isFileCollection(collection)) {
      const { path, content } = await this.editFileCollection(collection, (entries) => {
        delete entries[id];
      });

      await this.persist(path, content, message, versioned(expectedVersion));

      return;
    }

    const format = await this.storedFormat(collection, id);

    if (!format) throw new Error(`Entry not found: ${collection}/${id}`);

    return this.removeFile(this.getEntryPath(collection, id, format), message, expectedVersion);
  }

  /**
   * Only a file collection has an order to change: a glob collection's entries
   * are separate files, which the site orders however it likes. Refused rather
   * than attempted, because a glob collection has no container file and the
   * rewrite would otherwise write to the directory the collection lives in.
   */
  async reorderEntries(collection: string, ids: string[], expectedVersion?: string): Promise<void> {
    if (!this.isFileCollection(collection)) {
      throw new Error(`Collection is not ordered: ${collection}`);
    }

    const { path, content } = await this.editFileCollection(collection, (entries) =>
      Object.fromEntries(
        [...ids, ...Object.keys(entries)]
          .filter((id, index, all) => id in entries && all.indexOf(id) === index)
          .map((id) => [id, entries[id]]),
      ),
    );

    await this.persist(path, content, `Reorder ${collection}`, versioned(expectedVersion));
  }

  async getEntry(collection: string, id: string, format?: string): Promise<EntryContent> {
    const col = this.schemas[collection];

    if (!col) throw new Error(`Unknown collection: ${collection}`);

    if (this.isFileCollection(collection)) {
      const { format, entries, version } = await this.readFileCollection(collection);

      if (!entries[id]) throw new Error(`Entry not found: ${collection}/${id}`);

      return { id, data: entries[id], body: "", format, ...(version && { version }) };
    }

    const known: readonly EntryFormat[] = col.type === "content" ? CONTENT_FORMATS : DATA_FORMATS;

    // Which extension an entry is stored under is in the listing, and a listing
    // is one request that every backend already caches for the life of this one.
    // Without it this loop probes each format in turn, so an `.mdoc` entry costs
    // three round trips and a miss costs four.
    const hint = (format && asEntryFormat(format)) || (await this.storedFormat(collection, id));
    const extensions = hint ? [hint, ...known.filter((ext) => ext !== hint)] : known;

    for (const ext of extensions) {
      try {
        const { content, version } = await this.fetchRawEntry(collection, id, ext);
        const { data, body } = parseContent(content, ext);

        return { id, data, body, format: ext, ...(version && { version }) };
      } catch (error) {
        if (!isNotFound(error)) throw error;

        continue;
      }
    }

    throw new Error(`Entry not found: ${collection}/${id}`);
  }

  // Rename and duplicate compose the storage primitives, so they work uniformly
  // for glob and file collections (saveEntry/deleteEntry already branch on layout).
  /**
   * `expectedVersion` constrains the write that creates the target, which is only
   * the caller's to state when the target shares a file with the source — see
   * {@link renameEntry}, its one caller that passes it.
   */
  async duplicateEntry(
    collection: string,
    sourceId: string,
    targetId: string,
    expectedVersion?: string,
  ): Promise<string | undefined> {
    const source = await this.getEntry(collection, sourceId);

    return this.saveEntry(collection, targetId, {
      data: source.data,
      body: source.body,
      format: source.format,
      createOnly: true,
      ...(expectedVersion !== undefined && { expectedVersion }),
    });
  }

  /**
   * Two writes, of which only the first is based on what the caller read — the
   * second is based on what this request has just done. Which one that is
   * depends on the layout: in a file collection both entries live in the same
   * container, so the version describes the write that adds the new entry; in a
   * glob collection they are separate files, so it describes the removal of the
   * old one.
   */
  async renameEntry(
    collection: string,
    oldId: string,
    newId: string,
    expectedVersion?: string,
  ): Promise<void> {
    if (oldId === newId) return;

    const shared = this.isFileCollection(collection);

    const version = await this.duplicateEntry(
      collection,
      oldId,
      newId,
      shared ? expectedVersion : undefined,
    );

    await this.deleteEntry(collection, oldId, shared ? version : expectedVersion);
  }

  /** The format the listing reports for an entry, or null when it holds no such entry. */
  private async storedFormat(collection: string, id: string): Promise<EntryFormat | null> {
    const entries = await this.listEntries(collection);

    return entries.find((entry) => entry.id === id)?.format ?? null;
  }

  protected async fetchRawEntry(
    _collection: string,
    _id: string,
    _ext: string,
  ): Promise<VersionedContent> {
    throw new Error("Not implemented");
  }

  /** The raw content of a repository file, by project-relative path. */
  protected async fetchFileContent(_path: string): Promise<VersionedContent> {
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

  /**
   * A repository library has no URL to hand out: its bytes become a commit, so
   * they have to arrive here. The checks still run now rather than on arrival,
   * so an oversized or occupied upload is refused before it is sent.
   */
  async beginUpload(path: string, size: number, overwrite: boolean): Promise<UploadTicket> {
    await this.assertUploadable(path, size, overwrite);

    return { direct: false };
  }

  private async assertUploadable(path: string, size: number, overwrite: boolean): Promise<void> {
    assertWithinSizeLimit(size, this.options.maxFileSize);

    if (!isLibraryFile(path, this.options.mediaExtensions)) {
      throw new Error(`"${path}" is hidden or not of an allowed media type.`);
    }

    // Replacing a file is a different act from adding one: an upload that did
    // not ask to replace does not get to.
    if (!overwrite && (await this.listMedia()).some((entry) => entry.path === path)) {
      throw new Error(`A file already exists at "${path}".`);
    }
  }

  /** Where a repository library's own writes are checked, before any path is built. */
  async uploadMedia(path: string, bytes: Uint8Array, overwrite: boolean): Promise<void> {
    await this.assertUploadable(path, bytes.byteLength, overwrite);

    return this.writeMedia(this.mediaRepoPath(path), bytes);
  }

  async renameMedia(oldPath: string, newPath: string): Promise<void> {
    const from = this.mediaRepoPath(oldPath);
    const to = this.mediaRepoPath(newPath);

    if (from === to) return;

    return this.moveMedia(from, to);
  }

  async deleteMedia(path: string): Promise<void> {
    return this.removeMedia(this.mediaRepoPath(path));
  }

  abstract readMedia(path: string): Promise<MediaContent>;

  /**
   * A repository library has no trash, and needs none: a deletion here is a
   * commit on the draft branch, so the file is still in git — recoverable by
   * discarding the changeset before it publishes, and in history for good
   * afterwards. An object store keeps no history, which is the whole reason the
   * other library has a trash at all.
   */
  async listTrash(): Promise<TrashedFile[]> {
    return [];
  }

  restoreMedia(): Promise<never> {
    return Promise.reject(new HttpError(untrashable, 400));
  }

  purgeTrash(): Promise<never> {
    return Promise.reject(new HttpError(untrashable, 400));
  }

  /** The type a library file is served back as, derived from its name, never from a caller. */
  protected contentTypeOf(path: string): string {
    return mediaContentType(path);
  }

  /**
   * Lowers repository paths into library files, dropping strays in the media
   * directory. Takes the backend's own listing shape rather than `MediaFile`s, so
   * a whole-repository tree costs no allocation for the paths it discards.
   */
  protected mediaFiles(
    files: Iterable<{ path: string; size?: number; version?: string }>,
  ): MediaFile[] {
    const result: MediaFile[] = [];

    for (const file of files) {
      const path = stripMediaPrefix(file.path, this.mediaDirectory);

      if (path != null && isLibraryFile(path, this.options.mediaExtensions)) {
        result.push({ path, size: file.size ?? 0, ...(file.version && { version: file.version }) });
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

  /**
   * The format of a file collection's container. It is the loader's own file
   * name, so an unknown extension means the loader is one the CMS cannot read
   * rather than a caller mistake; JSON is the reading that parses most of them.
   */
  protected containerFormat(loaderFileName: string): EntryFormat {
    return asEntryFormat(getFileExtension(loaderFileName)) ?? "json";
  }

  /**
   * The container file as it stands, or an empty one when it does not exist yet
   * (or is not a file collection at all). Every read of one goes through here,
   * so the listing, the layout and a write all see the same parse.
   */
  private readFileCollection(collection: string): Promise<FileCollection> {
    const cached = this.containers.get(collection);

    if (cached) return cached;

    const pending = this.loadFileCollection(collection);

    this.containers.set(collection, pending);

    return pending;
  }

  private async loadFileCollection(collection: string): Promise<FileCollection> {
    const path = this.getFileLoaderPath(collection);
    const format = path ? this.containerFormat(path) : "json";
    const empty = { path: path ?? "", format, entries: {}, layout: "object" as const };

    if (!path) return empty;

    try {
      const { content, version } = await this.fetchFileContent(path);

      return { path, format, version, ...parseMultiEntryFile(content, format) };
    } catch (error) {
      if (!isNotFound(error)) throw error;

      return empty;
    }
  }

  /**
   * How a file collection stores its entries, which decides whether they can be
   * reordered, and the version a reorder has to be based on.
   */
  async getFileLayout(collection: string): Promise<FileCollectionInfo> {
    const { layout, version } = await this.readFileCollection(collection);

    return { layout, ...(version && { version }) };
  }

  protected async listFileCollectionEntries(collection: string): Promise<EntryMeta[]> {
    const { entries, format } = await this.readFileCollection(collection);

    return Object.keys(entries).map((id) => ({ id, collection, format }));
  }

  /**
   * A file collection rewritten by `mutate`, as the path and content to write.
   * All three ways to change one (upsert, remove, reorder) are the same
   * read-modify-serialize, so they differ only in the mutation.
   */
  protected async editFileCollection(
    collection: string,
    mutate: (
      entries: Record<string, Record<string, unknown>>,
    ) => Record<string, Record<string, unknown>> | void,
  ): Promise<{ path: string; content: string; version?: string }> {
    const { path, format, entries, layout, version } = await this.readFileCollection(collection);
    const edited = { ...entries };

    return {
      path,
      content: serializeMultiEntryFile(mutate(edited) ?? edited, format, layout),
      version,
    };
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

      const format = asEntryFormat(getFileExtension(path));

      if (!format) continue;

      result.push({ id: stripExtension(path.slice(prefix.length)), collection, format });
    }

    return result;
  }
}

/**
 * Shared lifecycle for backends that commit to a per-user branch (cms/<username>)
 * and integrate it into a default branch via a pull/merge request.
 *
 * The branch name comes from the session rather than from a provider lookup, and
 * whether it exists is resolved at most once per request. There is no cross-request
 * cache: an instance may be reused by a different editor, or not reused at all.
 */
export abstract class BranchedStorage extends StorageBase {
  /**
   * The *lookup*, not its answer, so the several reads one batched request makes
   * share it rather than each firing their own before the first resolves.
   */
  private branchExistsCache: Promise<boolean> | null = null;

  protected readonly publishMode: PublishMode;
  protected readonly branch: string;

  constructor(options: StorageOptions, publishMode: PublishMode) {
    super(options);
    this.publishMode = publishMode;
    this.branch = `${BRANCH_PREFIX}${options.login}`;
  }

  protected abstract get defaultBranch(): string;
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
    this.branchExistsCache = Promise.resolve(exists);
  }

  protected branchExists(): Promise<boolean> {
    // A failed lookup must not become what every later call reads: it is dropped
    // so the next one asks again rather than inheriting the rejection.
    this.branchExistsCache ??= this.checkBranchExists(this.branch).catch((err: unknown) => {
      this.branchExistsCache = null;

      throw err;
    });

    return this.branchExistsCache;
  }

  protected async readRef(): Promise<string> {
    return (await this.branchExists()) ? this.branch : this.defaultBranch;
  }

  async publish(): Promise<void> {
    if (!(await this.branchExists())) return;

    const cr =
      (await this.findOpenChangeRequest(this.branch)) ??
      (await this.createChangeRequest(this.branch));

    if (this.publishMode === "pull-request") return;

    try {
      await this.acceptChangeRequest(cr);
    } catch (err) {
      throw mapMergeError(err);
    }

    await this.dropBranch();
  }

  async update(): Promise<void> {
    if (await this.branchExists()) await this.doUpdate(this.branch);
  }

  async discard(): Promise<void> {
    if (await this.branchExists()) await this.dropBranch();
  }

  /**
   * Retires the draft branch and any change request on it, which is what both
   * discarding a changeset and publishing one come down to. Publishing has to
   * ask for it too: only GitLab removes the source branch as part of accepting,
   * so without this the branch would outlive the changeset on GitHub.
   */
  private async dropBranch(): Promise<void> {
    const cr = await this.findOpenChangeRequest(this.branch);

    if (cr) {
      try {
        await this.closeChangeRequest(cr.id);
      } catch {
        // Already closed.
      }
    }

    try {
      await this.deleteUserBranch(this.branch);
    } catch {
      // Already gone (e.g. removed along with the merge).
    }

    this.markBranchExists(false);
  }

  // The draft branch is the changeset: everything on it is pending, and publish
  // and discard act on all of it at once.
  async getChanges(): Promise<FileChange[]> {
    return (await this.branchExists()) ? this.diffAgainstDefault(this.branch) : [];
  }

  async getStatus(): Promise<BranchStatus> {
    if (!(await this.branchExists())) return { branch: "", behind: 0 };

    const status: BranchStatus = {
      branch: this.branch,
      behind: await this.computeBehind(this.branch),
    };

    if (this.publishMode === "pull-request") {
      const cr = await this.findOpenChangeRequest(this.branch);

      if (cr) status.changeRequestUrl = cr.url;
    }

    return status;
  }
}
