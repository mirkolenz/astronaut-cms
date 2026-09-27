import type { EntryMeta, EntryContent, MediaFile } from "@shared/types";
import { StorageBase } from "./base";
import { fileToBase64, stripMediaPrefix } from "./utils";
import type { PendingChange } from "@client/stores/changes-store";
import { fetchJson } from "@client/lib/api";

export class LocalStorage extends StorageBase {
  constructor(mediaDirectory: string) {
    super({}, mediaDirectory);
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    return fetchJson(`/entries/${collection}`);
  }

  async getEntry(collection: string, id: string): Promise<EntryContent> {
    return fetchJson(`/entries/${collection}/${encodeURIComponent(id)}`);
  }

  async listMedia(): Promise<MediaFile[]> {
    return fetchJson("/media");
  }

  async uploadMedia(path: string, file: File): Promise<MediaFile> {
    const content = await fileToBase64(file);
    return fetchJson("/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  }

  async replaceMedia(path: string, file: File): Promise<MediaFile> {
    const content = await fileToBase64(file);
    const relativePath = stripMediaPrefix(path, this.mediaDirectory);
    return fetchJson("/media", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relativePath, content }),
    });
  }

  async renameMedia(oldPath: string, newPath: string): Promise<MediaFile> {
    return fetchJson("/media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldPath: stripMediaPrefix(oldPath, this.mediaDirectory),
        newPath: stripMediaPrefix(newPath, this.mediaDirectory),
      }),
    });
  }

  async deleteMedia(path: string): Promise<void> {
    const relativePath = stripMediaPrefix(path, this.mediaDirectory);
    await fetchJson(`/media/${encodeURIComponent(relativePath)}`, {
      method: "DELETE",
    });
  }

  protected async doPublish(changes: PendingChange[]): Promise<void> {
    await fetchJson("/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
  }
}
