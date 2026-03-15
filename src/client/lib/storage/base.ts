import type { StorageBackend } from "./types";
import type { EntryMeta, EntryContent, SaveEntryRequest, MediaFile } from "@/shared/types";
import { serializeContent } from "@/shared/content-parser";
import type { PendingChange } from "@/client/stores/changes-store";
import { useChangesStore } from "@/client/stores/changes-store";

export abstract class StorageBase implements StorageBackend {
  protected mediaDirectory: string;

  constructor(mediaDirectory: string) {
    this.mediaDirectory = mediaDirectory;
  }

  abstract listEntries(collection: string): Promise<EntryMeta[]>;
  abstract getEntry(collection: string, id: string): Promise<EntryContent>;
  abstract listMedia(): Promise<MediaFile[]>;
  abstract uploadMedia(path: string, file: File): Promise<MediaFile>;
  abstract replaceMedia(path: string, file: File): Promise<MediaFile>;
  abstract renameMedia(oldPath: string, newPath: string): Promise<MediaFile>;
  abstract deleteMedia(path: string): Promise<void>;

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
    useChangesStore.getState().addChange({
      collection,
      entryId: id,
      action: "delete",
      format: "",
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
}
