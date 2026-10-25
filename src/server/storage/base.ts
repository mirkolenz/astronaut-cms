import { join } from "pathe";
import { TomlDate } from "smol-toml";
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
  StaleWriteError,
  versioned,
  type Precondition,
  type VersionedContent,
} from "./types.ts";
import type {
  CollectionManifest,
  CollectionManifestEntry,
  EntryMeta,
  EntryContent,
  EntryFormat,
  SaveEntryRequest,
  MediaFile,
  FileCollectionInfo,
  FileChange,
  TrashedFile,
} from "../../shared/types.ts";
import { asEntryFormat, entryFilePath, globEntry } from "../../shared/types.ts";
import {
  parseContent,
  parseMultiEntryFile,
  serializeContent,
  serializeMultiEntryFile,
  getFileExtension,
  type FileEntries,
  type MultiEntryFile,
} from "../../shared/content-parser.ts";
import {
  assertEntryDeletable,
  assertEntryWritable,
  type ContentSource,
  type MediaSource,
} from "../validation.ts";
import {
  assertWithinSizeLimit,
  isLibraryFile,
  type ClientMediaConfig,
  type MediaLibraryId,
  type WorkingTreeLibrary,
} from "../../shared/media.ts";
import { isRecord, type ComponentSchemaMap, type FieldSchema } from "../../shared/field-schema.ts";
import { activeVariant } from "../../shared/field-to-zod.ts";
import { stripMediaPrefix } from "../../shared/paths.ts";
import { HttpError, checked } from "../errors.ts";
import { ContentValidationError, diagnostic } from "../../shared/diagnostics.ts";
import { assertLibraryPath } from "@/server/library-path";

const untrashable =
  "This library keeps its deletions in the changeset rather than a trash. Discard the pending changes to bring a deleted file back.";

const BRANCH_PREFIX = "cms/";

const occupied = (path: string): HttpError =>
  new HttpError(`A file already exists at "${path}".`, 409);

/** The schema of the value at `key` inside a container that `field` describes. */
function childSchema(
  field: FieldSchema | undefined,
  key: string | number,
): FieldSchema | undefined {
  switch (field?.type) {
    case "array":
      return typeof key === "number" ? field.element : undefined;
    case "tuple":
      return typeof key === "number" ? field.items[key] : undefined;
    case "object":
      return typeof key === "string" ? field.shape[key] : undefined;
    case "record":
      return typeof key === "string" ? field.value : undefined;
    default:
      return undefined;
  }
}

/** Restore TOML date types lost when entry data passed through the JSON API. */
function restoreTomlDates<T>(
  value: T,
  previous: unknown,
  schema: FieldSchema | null | undefined,
  path = "",
): T {
  const field = schema?.type === "union" ? activeVariant(schema, value) : (schema ?? undefined);
  const restore = (item: unknown, old: unknown, key: string | number): unknown =>
    restoreTomlDates(item, old, childSchema(field, key), path ? `${path}.${key}` : `${key}`);

  if (typeof value === "string" && (previous instanceof Date || field?.type === "date")) {
    const date = new TomlDate(value);

    if (date.isValid()) return date as T;

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) return new TomlDate(parsed.toISOString()) as T;

    if (field?.type !== "date") return value;

    throw new ContentValidationError([diagnostic("Expected a TOML date.", path)]);
  }

  if (Array.isArray(value)) {
    const old = Array.isArray(previous) ? previous : [];

    return value.map((item, index) => restore(item, old[index], index)) as T;
  }

  if (isRecord(value)) {
    const old = isRecord(previous) ? previous : {};

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, restore(item, old[key], key)]),
    ) as T;
  }

  return value;
}

/** Both providers hand file contents back this way, whitespace and all. */
export const fromBase64 = (content: string): string =>
  new TextDecoder().decode(Uint8Array.fromBase64(content));

/**
 * What `load` answers for `key`, loaded at most once into `cache` and shared by
 * every caller. A failure is dropped rather than kept, so the next caller
 * retries instead of reading it.
 */
export function memoized<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const cached = cache.get(key);

  if (cached) return cached;

  const pending = load().catch((error: unknown): never => {
    if (cache.get(key) === pending) cache.delete(key);

    throw error;
  });

  cache.set(key, pending);

  return pending;
}

/** A file collection's container, parsed. */
interface FileCollection extends MultiEntryFile {
  path: string;
  format: EntryFormat;
  /** The container's version, which is every one of its entries' version too. */
  version?: string;
}

/** Everything a backend needs that is not the provider credential itself. */
export interface StorageOptions {
  collections: CollectionManifest;
  /** Both libraries, which decide how an entry spells an asset. */
  media: ClientMediaConfig;
  /**
   * The library this instance serves: the repository library, or, in a dev
   * run, the working-tree stand-in for the object store.
   */
  library: WorkingTreeLibrary;
  components: ComponentSchemaMap;
  /** The signed-in editor, which is what the draft branch is named after. */
  login: string;
}

/**
 * A Git storage backend is also the repository media library: media there is
 * committed to the same draft branch as content. Entry validation checks assets
 * against whichever library a reference names, which {@link useMediaLibraries}
 * hands it.
 *
 * One instance serves one request. Nothing here is cached across requests, which
 * is what makes it correct on a serverless runtime where an instance may be
 * shared between editors or discarded between clicks.
 */
export abstract class StorageBase implements StorageBackend, MediaBackend {
  protected readonly options: StorageOptions;
  protected readonly schemas: CollectionManifest;
  protected readonly mediaDirectory: string;
  private libraryOf: (library: MediaLibraryId) => MediaSource = () => this;

  /**
   * The container file of each file collection, read at most once per request.
   * Every entry of one lives in the same file, so a reference scan over an
   * N-entry collection would otherwise fetch and re-parse it N times.
   */
  private readonly containers = new Map<string, Promise<FileCollection>>();
  /**
   * Each collection's listing, made at most once between writes. Every entry
   * read and write looks its entry up in it, so a rename would otherwise list
   * the collection three times.
   */
  private readonly listings = new Map<string, Promise<EntryMeta[]>>();

  constructor(options: StorageOptions) {
    this.options = options;
    this.schemas = options.collections;
    this.mediaDirectory = options.library.directory;
  }

  /** Only the listings are needed, so this never grants writes to a library it does not own. */
  useMediaLibraries(libraryOf: (library: MediaLibraryId) => MediaSource): void {
    this.libraryOf = libraryOf;
  }

  listEntries(collection: string): Promise<EntryMeta[]> {
    return memoized(this.listings, collection, async () => {
      const col = this.schemas[collection];

      if (!col) return [];

      if (this.isFileCollection(collection)) return this.listFileCollectionEntries(collection);

      return Iterator.from(await this.globPaths(col))
        .map((path) => globEntry(col, path))
        .filter((entry) => entry !== null)
        .map((entry) => ({ ...entry, collection }))
        .toArray();
    });
  }

  /**
   * Repository paths at or below a glob collection's `globRoots`, of which the
   * listing keeps the files its loader loads.
   */
  protected abstract globPaths(col: CollectionManifestEntry): Promise<Iterable<string>>;
  abstract listMedia(): Promise<MediaFile[]>;
  /**
   * All three take repository paths, lowered by the funnels below, and persist a
   * write the library's limits have already been checked against.
   */
  protected abstract writeMedia(
    repoPath: string,
    bytes: Uint8Array<ArrayBuffer>,
    overwrite: boolean,
  ): Promise<void>;
  protected abstract moveMedia(from: string, to: string): Promise<void>;
  protected abstract removeMedia(repoPath: string): Promise<void>;
  /** A content write, after which what this request read is stale. */
  private async persist(
    path: string,
    content: string,
    message: string,
    precondition?: Precondition,
  ): Promise<string | undefined> {
    try {
      return await this.commitFile(path, content, message, precondition);
    } finally {
      this.invalidate();
    }
  }

  /** Drops the listings and containers this request read, which a write has made stale. */
  protected invalidate(): void {
    this.containers.clear();
    this.listings.clear();
  }

  private async tomlEntryData(
    path: string,
    data: Record<string, unknown>,
    schema: FieldSchema | null,
    createOnly: boolean,
  ): Promise<Record<string, unknown>> {
    let previous: Record<string, unknown> | undefined;

    try {
      if (!createOnly)
        previous = parseContent((await this.fetchFileContent(path)).content, "toml").data;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    return restoreTomlDates(data, previous, schema);
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
    const col = this.schema(collection);
    // An existing entry keeps its file, whose name astro may have slugged into
    // the id, so a new one also has to be absent from the listing.
    const stored = this.isFileCollection(collection)
      ? undefined
      : await this.storedEntry(collection, id);
    const path =
      !data.createOnly && stored?.format === data.format
        ? stored.path
        : entryFilePath(col, id, data.format);

    await assertEntryWritable(this.contentSource, { col, id, path, ...data });

    if (data.createOnly && stored && stored.path !== path) throw staleWrite(`${collection}/${id}`);

    const edited = this.isFileCollection(collection)
      ? await this.editFileCollection(collection, (entries, format) => {
          if (data.createOnly && entries.has(id)) throw staleWrite(`${collection}/${id}`);

          entries.set(
            id,
            format === "toml"
              ? restoreTomlDates(data.data, entries.get(id), col.schema)
              : data.data,
          );
        })
      : {
          path,
          content: serializeContent(
            data.format === "toml"
              ? await this.tomlEntryData(path, data.data, col.schema, data.createOnly ?? false)
              : data.data,
            data.body,
            data.format,
          ),
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

    assertEntryDeletable(this.schema(collection));

    if (this.isFileCollection(collection)) {
      const { path, content } = await this.editFileCollection(collection, (entries) => {
        entries.delete(id);
      });

      await this.persist(path, content, message, versioned(expectedVersion));

      return;
    }

    const stored = await this.storedEntry(collection, id);

    if (!stored) throw new Error(`Entry not found: ${collection}/${id}`);

    try {
      await this.removeFile(stored.path, message, expectedVersion);
    } finally {
      this.invalidate();
    }
  }

  /**
   * Only a collection sorted by file order has an order to change, which only a
   * file collection can be: a glob collection's entries are separate files. Any
   * other order is the site's, so a rewrite would change nothing it renders.
   */
  async reorderEntries(collection: string, ids: string[], expectedVersion?: string): Promise<void> {
    if (this.schemas[collection]?.sort !== "file") {
      throw new Error(`Collection is not sorted by file order: ${collection}`);
    }

    const { path, content } = await this.editFileCollection(
      collection,
      (entries) =>
        new Map(
          new Set(ids)
            .union(entries)
            .values()
            .filter((id) => entries.has(id))
            .map((id) => [id, entries.get(id)!]),
        ),
    );

    await this.persist(path, content, `Reorder ${collection}`, versioned(expectedVersion));
  }

  async getEntry(collection: string, id: string): Promise<EntryContent> {
    const stored = await this.storedEntry(collection, id);

    if (!stored) throw new Error(`Entry not found: ${collection}/${id}`);

    return this.readEntry(stored);
  }

  async readEntry({ collection, id, path, format }: EntryMeta): Promise<EntryContent> {
    if (this.isFileCollection(collection)) {
      const { entries, version } = await this.readFileCollection(collection);
      const data = entries.get(id);

      if (!data) throw new Error(`Entry not found: ${collection}/${id}`);

      return { id, path, data, body: "", format, ...(version && { version }) };
    }

    const { content, version } = await this.fetchFileContent(path);
    const { data, body } = parseContent(content, format);

    return { id, path, data, body, format, ...(version && { version }) };
  }

  /** A copy under a new id, which works uniformly because saveEntry branches on layout. */
  async duplicateEntry(collection: string, sourceId: string, targetId: string): Promise<void> {
    const source = await this.getEntry(collection, sourceId);

    await this.saveEntry(collection, targetId, {
      data: source.data,
      body: source.body,
      format: source.format,
      createOnly: true,
    });
  }

  /**
   * In a glob collection two writes, a copy and the removal of the original, and
   * the version describes the removal. In a file collection both entries share
   * one container, so it is one rewrite that keeps the entry where it was, since
   * its position may be the collection's order.
   */
  async renameEntry(
    collection: string,
    oldId: string,
    newId: string,
    expectedVersion?: string,
  ): Promise<void> {
    if (oldId === newId) return;

    if (!this.isFileCollection(collection)) {
      await this.duplicateEntry(collection, oldId, newId);
      await this.deleteEntry(collection, oldId, expectedVersion);

      return;
    }

    const entry = await this.getEntry(collection, oldId);

    await assertEntryWritable(this.contentSource, {
      ...entry,
      col: this.schema(collection),
      id: newId,
    });

    const { path, content } = await this.editFileCollection(collection, (entries) => {
      if (entries.has(newId)) throw staleWrite(`${collection}/${newId}`);

      return new Map(entries.entries().map(([id, item]) => [id === oldId ? newId : id, item]));
    });

    await this.persist(
      path,
      content,
      `Rename ${collection}/${oldId} to ${newId}`,
      versioned(expectedVersion),
    );
  }

  /** The entry as the memoized listing reports it, or undefined when there is none. */
  private async storedEntry(collection: string, id: string): Promise<EntryMeta | undefined> {
    return (await this.listEntries(collection)).find((entry) => entry.id === id);
  }

  /** The raw content of a repository file, by project-relative path. */
  protected async fetchFileContent(_path: string): Promise<VersionedContent> {
    throw new Error("Not implemented");
  }

  /** What entry validation resolves references and assets against. */
  protected get contentSource(): ContentSource {
    return {
      listEntries: (collection) => this.listEntries(collection),
      listMedia: (library) => this.libraryOf(library).listPaths(),
      media: this.options.media,
      components: this.options.components,
    };
  }

  // --- Repository media library ---

  /** The repository path of a library file. */
  protected mediaRepoPath(path: string): string {
    assertLibraryPath(path, this.options.library.extensions);

    return join(this.mediaDirectory, path);
  }

  /**
   * A repository library has no URL to hand out: its bytes become a commit, so
   * they have to arrive here. The checks still run now rather than on arrival,
   * so an oversized or occupied upload is refused before it is sent.
   */
  async beginUpload(path: string, size: number, overwrite: boolean): Promise<UploadTicket> {
    this.assertUploadable(path, size);

    // Replacing a file is a different act from adding one: an upload that did
    // not ask to replace does not get to.
    if (!overwrite && (await this.listPaths()).some((entry) => entry.path === path))
      throw occupied(path);

    return { direct: false };
  }

  private assertUploadable(path: string, size: number): string {
    checked(413, () => assertWithinSizeLimit(size, this.options.library));

    return this.mediaRepoPath(path);
  }

  /**
   * Where a repository library's own writes are checked before bytes reach a backend.
   * Every backend claims a new path atomically, so no listing is needed here.
   */
  async uploadMedia(
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
    overwrite: boolean,
  ): Promise<void> {
    try {
      await this.writeMedia(this.assertUploadable(path, bytes.byteLength), bytes, overwrite);
    } catch (error) {
      if (!overwrite && error instanceof StaleWriteError) throw occupied(path);

      throw error;
    }
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

  listPaths(): Promise<{ path: string }[]> {
    return this.listMedia();
  }

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

  /**
   * Lowers repository paths into library files, dropping strays in the media
   * directory. Takes the backend's own listing shape rather than `MediaFile`s, so
   * a whole-repository tree costs no allocation for the paths it discards.
   */
  protected mediaFiles(
    files: Iterable<{ path: string; size?: number; version?: string }>,
  ): MediaFile[] {
    return Iterator.from(files)
      .flatMap((file) => {
        const path = stripMediaPrefix(file.path, this.mediaDirectory);

        return path != null && isLibraryFile(path, this.options.library.extensions)
          ? [{ path, size: file.size ?? 0, ...(file.version && { version: file.version }) }]
          : [];
      })
      .toArray();
  }

  private schema(collection: string): CollectionManifestEntry {
    const col = this.schemas[collection];

    if (!col) throw new Error(`Unknown collection: ${collection}`);

    return col;
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
    return memoized(this.containers, collection, () => this.loadFileCollection(collection));
  }

  private async loadFileCollection(collection: string): Promise<FileCollection> {
    const path = this.getFileLoaderPath(collection);
    const format = path ? this.containerFormat(path) : "json";
    const empty: FileCollection = {
      path: path ?? "",
      format,
      entries: new Map(),
      layout: "object",
    };

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

  private async listFileCollectionEntries(collection: string): Promise<EntryMeta[]> {
    const { entries, format, path } = await this.readFileCollection(collection);

    return entries
      .keys()
      .map((id) => ({ id, collection, format, path }))
      .toArray();
  }

  /**
   * A file collection rewritten by `mutate`, as the path and content to write.
   * All three ways to change one (upsert, remove, reorder) are the same
   * read-modify-serialize, so they differ only in the mutation.
   */
  protected async editFileCollection(
    collection: string,
    mutate: (entries: FileEntries, format: EntryFormat) => FileEntries | void,
  ): Promise<{ path: string; content: string; version?: string }> {
    const { path, format, version, ...file } = await this.readFileCollection(collection);
    const edited = new Map(file.entries);

    return {
      path,
      content: serializeMultiEntryFile(
        { ...file, entries: mutate(edited, format) ?? edited },
        format,
      ),
      version,
    };
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
    if (!(await this.branchExists())) return;

    await this.doUpdate(this.branch);
    this.invalidate();
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
      } catch (err) {
        if (await this.findOpenChangeRequest(this.branch)) throw err;
      }
    }

    try {
      await this.deleteUserBranch(this.branch);
    } catch (err) {
      if (await this.checkBranchExists(this.branch)) throw err;
    }

    this.markBranchExists(false);
    this.invalidate();
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
