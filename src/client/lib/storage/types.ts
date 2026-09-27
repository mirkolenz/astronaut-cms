import type { EntryMeta, EntryContent, FileChange, SaveEntryRequest, MediaFile } from "@shared/types";

export type PublishMode = "direct" | "pull-request";

/**
 * The draft branch's standing relative to the default branch. What is *on* the
 * branch is the changeset (see `getChanges`); this only covers what the
 * changeset cannot say: where it lives, whether the default branch has moved on,
 * and where to review it.
 */
export interface BranchStatus {
  /** Draft branch name, empty for a backend without one. */
  branch: string;
  /** Commits the default branch is ahead of the draft, i.e. what `update` would merge in. */
  behind: number;
  changeRequestUrl?: string;
}

export interface ChangeRequestSummary {
  id: number;
  title: string;
  url: string;
}

export class MergeConflictError extends Error {
  constructor(message?: string) {
    super(message ?? "Merge conflict");
    this.name = "MergeConflictError";
  }
}

// Extracts an HTTP status code from a thrown error across SDK shapes:
// Octokit attaches `.status`; Gitbeaker attaches `.cause.response.status`.
export function getErrorStatus(err: unknown): number | undefined {
  const direct = (err as { status?: unknown }).status;
  if (typeof direct === "number") return direct;
  const nested = (err as { cause?: { response?: { status?: unknown } } }).cause?.response?.status;
  if (typeof nested === "number") return nested;
  return undefined;
}

export function mapMergeError(err: unknown): Error {
  const status = getErrorStatus(err);
  if (status === 405 || status === 406 || status === 409) return new MergeConflictError();
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * What a backend can do with its pending changes, fixed by the backend rather
 * than by the changes themselves. Local storage writes straight to the working
 * tree: there is no draft to merge in either direction, only changes to keep or
 * throw away.
 */
export interface StorageCapabilities {
  /** Integrate the pending changes into the published content. */
  publish: boolean;
  /** Merge newer published content back into the pending changes. */
  update: boolean;
}

export interface StorageBackend {
  readonly capabilities: StorageCapabilities;
  listEntries(collection: string): Promise<EntryMeta[]>;
  getEntry(collection: string, id: string): Promise<EntryContent>;
  saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<void>;
  deleteEntry(collection: string, id: string): Promise<void>;
  renameEntry(collection: string, oldId: string, newId: string): Promise<void>;
  duplicateEntry(collection: string, sourceId: string, targetId: string): Promise<void>;
  reorderEntries(collection: string, ids: string[]): Promise<void>;
  listMedia(): Promise<MediaFile[]>;
  uploadMedia(path: string, file: File): Promise<MediaFile>;
  replaceMedia(path: string, file: File): Promise<MediaFile>;
  renameMedia(oldPath: string, newPath: string): Promise<MediaFile>;
  deleteMedia(path: string): Promise<void>;

  publish(): Promise<void>;
  update(): Promise<void>;
  discard(): Promise<void>;
  getStatus(): Promise<BranchStatus>;
  /** Everything pending since the last publish, as one reviewable unit. */
  getChanges(): Promise<FileChange[]>;
}
