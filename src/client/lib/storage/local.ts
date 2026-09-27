import { join } from "pathe";
import type { EntryMeta, FileChange, MediaFile, SaveEntryRequest } from "@shared/types";
import { serializeContent } from "@shared/content-parser";
import { StorageBase } from "./base";
import type { BranchStatus, StorageCapabilities } from "./types";
import { fileToBase64, stripMediaPrefix } from "./utils";
import { fetchJson } from "@client/lib/api";

const filePath = (path: string) => `/files/${encodeURIComponent(path)}`;

/**
 * Writes straight to the working tree through the dev middleware's file API.
 * Everything above the file layer — parsing, serializing, the file-collection
 * merge — comes from {@link StorageBase}, the same way the Git backends get it.
 */
export class LocalStorage extends StorageBase {
  // The working tree is already the live content: there is no draft branch to
  // merge in either direction.
  readonly capabilities: StorageCapabilities = { publish: false, update: false };

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (this.isFileCollection(collection)) return this.listFileCollectionEntries(collection);

    const files = await this.listDirectory(this.getCollectionPath(collection));

    return this.entriesFromTreePaths(
      collection,
      files.map((file) => file.path),
    );
  }

  protected async fetchFileContent(path: string): Promise<string> {
    const { content } = await fetchJson<{ content: string }>(filePath(path));

    return content;
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    return this.fetchFileContent(this.getEntryPath(collection, id, ext));
  }

  protected async writeEntry(
    collection: string,
    id: string,
    data: SaveEntryRequest,
  ): Promise<void> {
    if (this.isFileCollection(collection)) {
      const { path, content } = await this.upsertFileCollectionEntry(collection, id, data.data);

      return this.writeFile(path, content);
    }

    return this.writeFile(
      this.getEntryPath(collection, id, data.format),
      serializeContent(data.data, data.body, data.format),
    );
  }

  async deleteEntry(collection: string, id: string): Promise<void> {
    if (this.isFileCollection(collection)) {
      const { path, content } = await this.removeFileCollectionEntry(collection, id);

      return this.writeFile(path, content);
    }

    const entry = await this.getEntry(collection, id);

    await fetchJson(filePath(this.getEntryPath(collection, id, entry.format)), {
      method: "DELETE",
    });
  }

  async reorderEntries(collection: string, ids: string[]): Promise<void> {
    const { path, content } = await this.buildReorderedFileCollection(collection, ids);

    return this.writeFile(path, content);
  }

  async listMedia(): Promise<MediaFile[]> {
    return this.mediaFiles(await this.listDirectory(this.mediaDirectory));
  }

  async uploadMedia(path: string, file: File): Promise<MediaFile> {
    const repoPath = join(this.mediaDirectory, path);

    await this.writeFile(repoPath, await fileToBase64(file), "base64");

    return { path: repoPath, size: file.size, lastModified: new Date().toISOString() };
  }

  async replaceMedia(path: string, file: File): Promise<MediaFile> {
    return this.uploadMedia(stripMediaPrefix(path, this.mediaDirectory), file);
  }

  async renameMedia(oldPath: string, newPath: string): Promise<MediaFile> {
    await fetchJson(filePath(oldPath), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: newPath }),
    });

    return { path: newPath, size: 0, lastModified: new Date().toISOString() };
  }

  async deleteMedia(path: string): Promise<void> {
    await fetchJson(filePath(path), { method: "DELETE" });
  }

  // Discard is meaningful without a branch: it is git restoring the files the
  // CMS manages (see the dev middleware).
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

  private async listDirectory(dir: string): Promise<MediaFile[]> {
    return fetchJson(`/files?dir=${encodeURIComponent(dir)}`);
  }

  private async writeFile(path: string, content: string, encoding?: "base64"): Promise<void> {
    await fetchJson(filePath(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, encoding }),
    });
  }
}
