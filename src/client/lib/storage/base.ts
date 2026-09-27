import type { StorageBackend } from "./types";
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
import {
  parseContent,
  serializeContent,
  parseMultiEntryFile,
  serializeMultiEntryFile,
  getFileExtension,
} from "@shared/content-parser";
import { validateSegment, validatePath, validateFormat } from "@shared/validation";
import type { PendingChange } from "@client/stores/changes-store";
import { useChangesStore } from "@client/stores/changes-store";

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

  async getEntry(collection: string, id: string): Promise<EntryContent> {
    const col = this.schemas[collection];
    if (!col) throw new Error(`Unknown collection: ${collection}`);

    // For file collections, fetch the whole file and extract the entry directly.
    // This avoids a JSON.stringify→parseContent round-trip through fetchRawEntry.
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

  async saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<void> {
    const content = serializeContent(data.data, data.body, data.format);
    const existing = useChangesStore
      .getState()
      .changes.find((c) => c.collection === collection && c.entryId === id);
    const action = existing?.action === "create" ? "create" : "update";
    useChangesStore.getState().addChange({
      collection,
      entryId: id,
      action,
      content,
      format: data.format,
      message: `${action === "create" ? "Create" : "Update"} ${collection}/${id}`,
    });
  }

  async deleteEntry(collection: string, id: string): Promise<void> {
    let format = "";
    // For file collections, format is known from the loader file name
    const loaderFileName = this.getFileLoaderPath(collection);
    if (loaderFileName) {
      format = getFileExtension(loaderFileName) || "json";
    } else {
      try {
        const entry = await this.getEntry(collection, id);
        format = entry.format;
      } catch {
        const pending = useChangesStore
          .getState()
          .changes.find((c) => c.collection === collection && c.entryId === id);
        if (pending) {
          format = pending.format;
        }
      }
    }

    useChangesStore.getState().addChange({
      collection,
      entryId: id,
      action: "delete",
      format,
      message: `Delete ${collection}/${id}`,
    });
  }

  async publish(): Promise<void> {
    const store = useChangesStore.getState();
    const { changes } = store;
    if (changes.length === 0) return;

    store.setPublishing(true);
    store.setPublishError(null);

    try {
      await this.doPublish(changes);
      store.clearChanges();
    } catch (err) {
      store.setPublishError(err instanceof Error ? err.message : "Publish failed");
      throw err;
    } finally {
      store.setPublishing(false);
    }
  }

  protected abstract doPublish(changes: PendingChange[]): Promise<void>;

  // --- File collection helpers ---

  protected isFileCollection(collection: string): boolean {
    return this.schemas[collection]?.loaderType === "file";
  }

  protected getFileLoaderPath(collection: string): string | null {
    return this.schemas[collection]?.loaderFileName ?? null;
  }

  /**
   * Lists entries for a file() collection by fetching and parsing the single file.
   * Subclasses should call this from their listEntries() for file collections.
   */
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

  /**
   * Separates pending changes into glob changes and grouped file-collection changes.
   */
  protected groupChangesForPublish(changes: PendingChange[]): {
    globChanges: PendingChange[];
    fileCollections: Record<string, PendingChange[]>;
  } {
    const globChanges: PendingChange[] = [];
    const fileCollections: Record<string, PendingChange[]> = {};

    for (const change of changes) {
      if (!this.schemas[change.collection]) continue;
      if (this.isFileCollection(change.collection)) {
        (fileCollections[change.collection] ??= []).push(change);
      } else {
        globChanges.push(change);
      }
    }

    return { globChanges, fileCollections };
  }

  /**
   * Fetches a file-collection file, applies a batch of changes, and returns
   * the serialized result. Subclasses use this in doPublish().
   */
  protected async mergeFileCollectionChanges(
    collection: string,
    changes: PendingChange[],
  ): Promise<{ path: string; content: string; fileExists: boolean; messages: string[] }> {
    const loaderFileName = this.getFileLoaderPath(collection)!;
    const format = getFileExtension(loaderFileName) || "json";

    let entries: Record<string, Record<string, unknown>> = {};
    let layout: FileEntryLayout = "object";
    let fileExists = true;
    try {
      const raw = await this.fetchFileContent(loaderFileName);
      const parsed = parseMultiEntryFile(raw, format);
      entries = parsed.entries;
      layout = parsed.layout;
    } catch {
      fileExists = false;
    }

    const messages: string[] = [];
    for (const change of changes) {
      if (change.action === "delete") {
        delete entries[change.entryId];
      } else if (change.content) {
        const { data } = parseContent(change.content, change.format);
        entries[change.entryId] = data;
      }
      messages.push(change.message);
    }

    const content = serializeMultiEntryFile(entries, format, layout);
    return { path: loaderFileName, content, fileExists, messages };
  }

  // --- Glob collection helpers ---

  protected getEntryPath(collection: string, entryId: string, format: string): string {
    validateSegment(collection, "collection");
    validatePath(entryId, "entryId");
    validateFormat(format);
    return `src/content/${collection}/${entryId}.${format}`;
  }

  protected buildCommitMessage(messages: string[]): string {
    if (messages.length === 1) return messages[0];
    return `Update ${messages.length} entries\n\n${messages.join("\n")}`;
  }
}
