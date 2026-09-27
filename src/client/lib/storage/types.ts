import type {
  EntryMeta,
  EntryContent,
  FileChange,
  FileEntryLayout,
  SaveEntryRequest,
} from "@shared/types";

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

/**
 * Whether a lookup found its target. Only a provider 404 counts as absent:
 * reading an auth failure, a rate limit or an outage that way would report a
 * draft branch as missing, silently hiding its changes behind the default branch
 * and letting a later write try to recreate a branch that already exists.
 */
export async function exists(lookup: Promise<unknown>): Promise<boolean> {
  try {
    await lookup;

    return true;
  } catch (err) {
    if (getErrorStatus(err) === 404) return false;

    throw err;
  }
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

/**
 * Content storage. The media library used to be part of this, and for a Git
 * backend still is in practice (see `MediaBackend`), but it is configured
 * separately: a site can keep its content in Git and its media in an object
 * store.
 */
export interface StorageBackend {
  readonly capabilities: StorageCapabilities;
  listEntries(collection: string): Promise<EntryMeta[]>;
  /** `format` is a hint from a listing, saving the fallback search over extensions. */
  getEntry(collection: string, id: string, format?: string): Promise<EntryContent>;
  saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<void>;
  deleteEntry(collection: string, id: string): Promise<void>;
  renameEntry(collection: string, oldId: string, newId: string): Promise<void>;
  duplicateEntry(collection: string, sourceId: string, targetId: string): Promise<void>;
  reorderEntries(collection: string, ids: string[]): Promise<void>;
  getFileLayout(collection: string): Promise<FileEntryLayout>;

  publish(): Promise<void>;
  update(): Promise<void>;
  discard(): Promise<void>;
  getStatus(): Promise<BranchStatus>;
  /** Everything pending since the last publish, as one reviewable unit. */
  getChanges(): Promise<FileChange[]>;
}
