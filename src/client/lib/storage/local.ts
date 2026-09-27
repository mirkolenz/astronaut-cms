import type { EntryMeta, EntryContent, MediaFile } from "@shared/types";
import { StorageBase } from "./base";
import { fileToBase64, stripMediaPrefix } from "./utils";
import type { PendingChange } from "@client/stores/changes-store";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export class LocalStorage extends StorageBase {
  constructor(mediaDirectory: string) {
    super({}, mediaDirectory);
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    return fetchJson(`/__cms/entries/${collection}`);
  }

  async getEntry(collection: string, id: string): Promise<EntryContent> {
    return fetchJson(`/__cms/entries/${collection}/${encodeURIComponent(id)}`);
  }

  async listMedia(): Promise<MediaFile[]> {
    return fetchJson("/__cms/media");
  }

  async uploadMedia(path: string, file: File): Promise<MediaFile> {
    const content = await fileToBase64(file);
    return fetchJson("/__cms/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  }

  async replaceMedia(path: string, file: File): Promise<MediaFile> {
    const content = await fileToBase64(file);
    const relativePath = stripMediaPrefix(path, this.mediaDirectory);
    return fetchJson("/__cms/media", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relativePath, content }),
    });
  }

  async renameMedia(oldPath: string, newPath: string): Promise<MediaFile> {
    return fetchJson("/__cms/media", {
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
    await fetchJson(`/__cms/media/${encodeURIComponent(relativePath)}`, {
      method: "DELETE",
    });
  }

  protected async doPublish(changes: PendingChange[]): Promise<void> {
    await fetchJson("/__cms/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
  }
}
