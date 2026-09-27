import type {
  EntryMeta,
  EntryContent,
  FileChange,
  FileEntryLayout,
  MediaFile,
  SaveEntryRequest,
  TrashedFile,
} from "../../shared/types.ts";
import type { PresignedUpload } from "../../media/store.ts";

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

/** The HTTP status a failed provider call carried, if it was one (see `ApiError`). */
export function getErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown }).status;

  return typeof status === "number" ? status : undefined;
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
 * Where the bytes of one library file come from. A backend that can hand out a
 * URL the browser may load itself does; the rest return the bytes and let the
 * route stream them.
 */
export type MediaContent =
  | { redirect: string }
  | { bytes: Uint8Array<ArrayBuffer>; contentType: string };

/**
 * Content storage, as the operation registry addresses it. The media library is
 * part of it for a repository backend and configured separately for an object
 * store (see `server/media.ts`), which is why the two halves are declared apart.
 */
export interface StorageBackend {
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

/** Where an upload's bytes go. A library that cannot presign takes them through the route. */
export type UploadTicket = ({ direct: true } & PresignedUpload) | { direct: false };

/**
 * The media library, whether it is the repository itself or an object store.
 * One contract for both, so nothing above this layer branches on which it is.
 */
export interface MediaBackend {
  listMedia(): Promise<MediaFile[]>;
  /**
   * Where to put the bytes for `path`, decided before any of them exist. Nothing
   * is reserved by this call: a ticket says only that the request is allowed in
   * principle, and the destination is claimed on arrival.
   */
  beginUpload(path: string, size: number, overwrite: boolean): Promise<UploadTicket>;
  /** Takes the bytes through this server, for a library that handed out no URL. */
  uploadMedia(path: string, bytes: Uint8Array, overwrite: boolean): Promise<void>;
  renameMedia(from: string, to: string): Promise<void>;
  deleteMedia(path: string): Promise<void>;
  readMedia(path: string): Promise<MediaContent>;
  /**
   * Deletions that can still be undone. Empty for a library whose deletions are
   * a commit, since git keeps those whether or not the CMS offers a trash.
   */
  listTrash(): Promise<TrashedFile[]>;
  restoreMedia(id: string): Promise<void>;
  purgeTrash(id: string): Promise<void>;
}
