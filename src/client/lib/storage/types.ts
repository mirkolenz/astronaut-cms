import type { EntryMeta, EntryContent, SaveEntryRequest, MediaFile } from "@shared/types";

export type PublishMode = "direct" | "pull-request";

export interface BranchStatus {
  hasBranch: boolean;
  branch: string;
  ahead: number;
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

export interface StorageBackend {
  listEntries(collection: string): Promise<EntryMeta[]>;
  getEntry(collection: string, id: string): Promise<EntryContent>;
  saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<void>;
  deleteEntry(collection: string, id: string): Promise<void>;
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
}
