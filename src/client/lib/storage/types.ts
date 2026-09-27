import type { EntryMeta, EntryContent, SaveEntryRequest, MediaFile } from "@shared/types";

export interface StorageBackend {
  listEntries(collection: string): Promise<EntryMeta[]>;
  getEntry(collection: string, id: string): Promise<EntryContent>;
  saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<void>;
  deleteEntry(collection: string, id: string): Promise<void>;
  listMedia(): Promise<MediaFile[]>;
  uploadMedia(path: string, file: File): Promise<MediaFile>;
  replaceMedia(path: string, file: File): Promise<MediaFile>;
  renameMedia(oldPath: string, newPath: string): Promise<MediaFile>;
  deleteMedia(path: string): Promise<void>;
  publish(): Promise<void>;
}
