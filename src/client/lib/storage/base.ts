import type { StorageBackend } from "./types";
import type {
  CollectionInfo,
  EntryMeta,
  EntryContent,
  SaveEntryRequest,
  MediaFile,
  CONTENT_FORMATS,
  DATA_FORMATS,
} from "@/shared/types";
import { parseContent, serializeContent } from "@/shared/content-parser";
import { validateSegment, validatePath, validateFormat } from "@/shared/validation";
import type { PendingChange } from "@/client/stores/changes-store";
import { useChangesStore } from "@/client/stores/changes-store";

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

    const extensions: readonly string[] =
      col.type === "content"
        ? (["md", "mdx", "mdoc"] satisfies Array<(typeof CONTENT_FORMATS)[number]>)
        : (["json", "yaml", "yml"] satisfies Array<(typeof DATA_FORMATS)[number]>);

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
