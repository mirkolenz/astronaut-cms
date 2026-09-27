import type { MediaFile } from "@shared/types";

/**
 * The media library, independent of where content is stored. Every path is
 * relative to the library root; `mediaRef` turns one into what content stores.
 */
export interface MediaBackend {
  /** Whether a change joins the pending changeset. False for an object store, which writes at once. */
  readonly transactional: boolean;
  listMedia(): Promise<MediaFile[]>;
  /** Writes `file` to `path`, replacing whatever was there. */
  uploadMedia(path: string, file: File): Promise<void>;
  renameMedia(from: string, to: string): Promise<void>;
  deleteMedia(path: string): Promise<void>;
  /**
   * Where the admin can load the file from. Async because a repository has to be
   * asked with the editor's token, and a Blob when that is all the backend can
   * produce — the caller owns the object URL, since only it knows the lifetime.
   */
  readUrl(path: string): Promise<string | Blob>;
}
