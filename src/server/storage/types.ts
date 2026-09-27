import type { ByteRange, PartialContent } from "../../shared/http.ts";
import type {
  EntryMeta,
  EntryContent,
  FileChange,
  FileCollectionInfo,
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

/**
 * A file as it was read, with whatever the backend calls that state.
 *
 * The token a write hands back to say which state it was based on: a commit id
 * on GitLab, a blob hash on GitHub, a content digest against the working tree.
 * Opaque, and compared only against itself — a backend with nothing to name a
 * state by returns none, and the write then takes the last word as it always
 * did. ({@link MediaFile.version} serves the other purpose a version can, naming
 * bytes so a URL can address them; the two are read from the same listings but
 * are not interchangeable.)
 */
export interface VersionedContent {
  content: string;
  version?: string;
}

/**
 * A write refused because the file moved under it: what the caller read is no
 * longer what is there.
 *
 * Distinct from {@link MergeConflictError}, which is the provider declining to
 * merge a branch. Both are the editor's to resolve, but only one of them is
 * resolved by reloading the entry, so the admin has to be able to tell them
 * apart — and the copy it shows is its own, translated, rather than a sentence
 * composed here.
 */
export class StaleWriteError extends Error {
  constructor(what: string) {
    super(`${what} changed since it was read.`);
    this.name = "StaleWriteError";
  }
}

export const staleWrite = (what: string): StaleWriteError => new StaleWriteError(what);

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

export function getErrorCode(err: unknown): unknown {
  return typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
}

/** Absence, in the dialect of every backend: a provider 404 or a filesystem `ENOENT`. */
export function isNotFound(err: unknown): boolean {
  return getErrorStatus(err) === 404 || getErrorCode(err) === "ENOENT";
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
    if (isNotFound(err)) return false;

    throw err;
  }
}

/**
 * What a write requires of the path it is claiming, as one value: the state it
 * was based on, or that there was no state at all. Two separate parameters could
 * say both at once, which means nothing and left each backend to invent its own
 * precedence for the pair.
 */
export type Precondition = { version: string } | { absent: true };

/** The precondition an optional version stands for: none at all when it is absent. */
export function versioned(version?: string): Precondition | undefined {
  return version === undefined ? undefined : { version };
}

/** Whether the state a backend actually found satisfies the write's precondition. */
export function satisfies(actual: string | undefined, precondition: Precondition): boolean {
  return "absent" in precondition ? actual === undefined : actual === precondition.version;
}

export function mapMergeError(err: unknown): Error {
  const status = getErrorStatus(err);

  if (status === 405 || status === 406 || status === 409) return new MergeConflictError();

  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Where the bytes of one library file come from. A backend that can hand out a
 * URL the browser may load itself does; the rest return a body and let the route
 * serve it.
 */
export type MediaContent = {
  /**
   * What this file's contents are, where the backend knows it without asking for
   * it. The route serves an immutable cache only when the URL's version matches
   * this one, so the policy comes from the file rather than from whatever a
   * caller appended, and a backend that cannot say degrades to the short cache
   * rather than to a wrong one. It is also the answer's entity tag, which is
   * what makes that short cache end in a 304 rather than in the bytes again.
   */
  version?: string;
} & (
  | { redirect: string }
  | {
      body: BodyInit | null;
      contentType: string;
      /** How the range the backend was asked for was answered, absent without one. */
      partial?: PartialContent;
    }
);

/**
 * Content storage, as the operation registry addresses it. The media library is
 * part of it for a repository backend and configured separately for an object
 * store (see `server/media.ts`), which is why the two halves are declared apart.
 */
export interface StorageBackend {
  listEntries(collection: string): Promise<EntryMeta[]>;
  /** `format` is a hint from a listing, saving the fallback search over extensions. */
  getEntry(collection: string, id: string, format?: string): Promise<EntryContent>;
  /**
   * Answers with the version the entry now has, so the editor that saved can
   * keep editing without its next write looking stale. Absent for a backend that
   * names no versions.
   */
  saveEntry(collection: string, id: string, data: SaveEntryRequest): Promise<string | undefined>;
  /**
   * Each takes the {@link VersionedContent} version its caller read, so a write
   * cannot silently discard one that landed in between. Absent means "whatever
   * is there now", which is what a caller with nothing to compare against can
   * honestly claim.
   */
  deleteEntry(collection: string, id: string, expectedVersion?: string): Promise<void>;
  renameEntry(
    collection: string,
    oldId: string,
    newId: string,
    expectedVersion?: string,
  ): Promise<void>;
  duplicateEntry(
    collection: string,
    sourceId: string,
    targetId: string,
  ): Promise<string | undefined>;
  reorderEntries(collection: string, ids: string[], expectedVersion?: string): Promise<void>;
  getFileLayout(collection: string): Promise<FileCollectionInfo>;

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
  /**
   * A backend handing over bytes honours `range` and says so with `partial`, so
   * a seek in a large video never reads the whole file. A redirect leaves the
   * range to whoever serves it.
   */
  readMedia(path: string, range?: ByteRange): Promise<MediaContent>;
  /**
   * Deletions that can still be undone. Empty for a library whose deletions are
   * a commit, since git keeps those whether or not the CMS offers a trash.
   */
  listTrash(): Promise<TrashedFile[]>;
  restoreMedia(id: string): Promise<void>;
  purgeTrash(id: string): Promise<void>;
}
