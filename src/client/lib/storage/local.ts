import type { EntryMeta, EntryContent, FileChange, MediaFile, SaveEntryRequest } from "@shared/types";
import { StorageBase } from "./base";
import type { BranchStatus, StorageCapabilities } from "./types";
import { fileToBase64, stripMediaPrefix } from "./utils";
import { fetchJson } from "@client/lib/api";

// Writes go straight to the filesystem via dev middleware; branch lifecycle
// methods are no-ops.
export class LocalStorage extends StorageBase {
  // Writes land in the working tree, which is already the live content: there is
  // no draft branch to merge in either direction.
  readonly capabilities: StorageCapabilities = { publish: false, update: false };

  async listEntries(collection: string): Promise<EntryMeta[]> {
    return fetchJson(`/entries/${collection}`);
  }

  async getEntry(collection: string, id: string): Promise<EntryContent> {
    return fetchJson(`/entries/${collection}/${encodeURIComponent(id)}`);
  }

  protected async writeEntry(
    collection: string,
    id: string,
    data: SaveEntryRequest,
  ): Promise<void> {
    await fetchJson(`/entries/${collection}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async deleteEntry(collection: string, id: string): Promise<void> {
    await fetchJson(`/entries/${collection}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async reorderEntries(collection: string, ids: string[]): Promise<void> {
    await fetchJson(`/entries/${collection}/_reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
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
    await fetchJson(`/media/${encodeURIComponent(relativePath)}`, { method: "DELETE" });
  }

  // Discard is still meaningful without a branch: it is git restoring the files
  // the CMS manages (see the dev middleware).
  async publish(): Promise<void> {}
  async update(): Promise<void> {}

  async discard(): Promise<void> {
    await fetchJson("/changes", { method: "DELETE" });
  }

  async getStatus(): Promise<BranchStatus> {
    return { branch: "", behind: 0 };
  }

  async getChanges(): Promise<FileChange[]> {
    return fetchJson("/changes");
  }
}
