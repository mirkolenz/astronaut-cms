/**
 * The media library of an object store, as a control plane rather than a data
 * plane. Policy, credentials and every decision about what an upload is allowed
 * to be live here; the bytes themselves go browser-to-store wherever the store
 * can be asked for a URL, because a serverless function is a poor file server.
 *
 * Handing out that URL is the whole of an upload, because every decision made
 * here is signed into it: the exact byte count, the content type the store will
 * serve back, and the precondition that refuses an occupied destination. The
 * store enforces all three as the write happens, so there is nothing left for a
 * second call to check and no window in which a check could go stale.
 */
import type { MediaBackend, MediaContent, UploadTicket } from "./storage/types.ts";
import type { MediaFile, TrashedFile } from "../shared/types.ts";
import type { MediaServerConfig } from "../integration/types.ts";
import { HttpError, checked } from "./errors.ts";
import { mediaPathError, validateMediaPath } from "../shared/validation.ts";
import {
  assertWithinSizeLimit,
  isLibraryFile,
  isActiveContentType,
  mediaContentType,
  remoteMediaUrl,
} from "../shared/media.ts";
import type { MediaStore, UploadTerms } from "../media/store.ts";

/**
 * Where a deletion goes instead of being dropped, and what `listTrash` reads
 * back out.
 *
 * An object store keeps no history, so a delete is final in a way a repository
 * delete is not. What may safely be deleted also depends on what content
 * references it, and that is a precondition the store cannot check — so rather
 * than pretend the check is airtight, the operation is made undoable: a stale
 * reference scan, a mis-click or an assistant that read the wrong thing costs a
 * restore rather than the file.
 *
 * The prefix cannot be addressed as a library path, since `toKey` refuses every
 * hidden segment, so it is reachable only through the three methods below.
 * Give it a lifecycle rule to decide how long a deletion stays undoable. Note
 * that a public bucket serves these keys too, so a deleted file stays readable
 * to anyone who knows one until that rule expires it.
 */
const TRASH_SEGMENT = ".trash";

/**
 * A trash id is `.trash/<deleted-at>-<original path>`, which carries everything
 * a restore needs without a second place to look it up. The timestamp is all
 * digits and a path cannot start with `-`, so the split is unambiguous even for
 * a file named `2024-notes.png`.
 */
const trashId = (path: string, at: number): string => `${TRASH_SEGMENT}/${at}-${path}`;

const TRASH_ID = /^\.trash\/(\d+)-(.+)$/;

/**
 * The deletion an id names, or null for anything `trashId` could not have
 * issued. The path has to be one a library file could have had, so a stored key
 * or a caller's id cannot traverse, or point back into a hidden prefix, and the
 * id has to be the exact spelling `trashId` produces for it.
 */
function parseTrashId(id: string): { path: string; deletedAt: number } | null {
  const match = TRASH_ID.exec(id);

  if (!match) return null;

  const [, stamp = "", path = ""] = match;
  const deletedAt = Number(stamp);
  const issued =
    mediaPathError(path) === null && isLibraryFile(path, null) && trashId(path, deletedAt) === id;

  return issued ? { deletedAt, path } : null;
}

export class ObjectStoreLibrary implements MediaBackend {
  private readonly store: MediaStore;
  private readonly config: MediaServerConfig;
  private readonly extensions: string[] | null;
  private readonly maxFileSize: number | null;

  constructor(
    store: MediaStore,
    config: MediaServerConfig,
    limits: { extensions: string[] | null; maxFileSize: number | null },
  ) {
    this.store = store;
    this.config = config;
    this.extensions = limits.extensions;
    this.maxFileSize = limits.maxFileSize;
  }

  /** A library path, checked and lowered to the store key it addresses. */
  private toKey(path: string): string {
    checked(400, () => validateMediaPath(path));

    if (!isLibraryFile(path, this.extensions)) {
      throw new HttpError(`"${path}" is hidden or not of an allowed media type.`, 400);
    }

    return `${this.config.prefix}${path}`;
  }

  /**
   * What an upload is allowed to be, settled from the path alone. A store serves
   * back whatever type it was given, so letting the caller choose it is letting
   * the caller choose how the bytes are interpreted.
   */
  private terms(path: string, length: number, overwrite: boolean): UploadTerms {
    checked(413, () => assertWithinSizeLimit(length, this.maxFileSize));

    const contentType = mediaContentType(path);

    return {
      length,
      contentType,
      attachment: isActiveContentType(contentType),
      ifAbsent: !overwrite,
    };
  }

  /**
   * A destination the caller is entitled to write. Only ever the second half of
   * a claim: the write that follows carries the same condition, so this exists
   * to name the conflict rather than to prevent it.
   */
  private async assertWritable(key: string, path: string, overwrite: boolean): Promise<void> {
    if (overwrite || !(await this.store.head(key))) return;

    throw new HttpError(
      `A file already exists at "${path}". Use a different name, or replace it deliberately.`,
      409,
    );
  }

  async listMedia(): Promise<MediaFile[]> {
    const objects = await this.store.list(this.config.prefix);

    return objects
      .map(({ key, size, version }) => ({
        path: key.slice(this.config.prefix.length),
        size,
        ...(version && { version }),
      }))
      .filter((file) => isLibraryFile(file.path, this.extensions));
  }

  /**
   * The public URL a library file is served under. The admin addresses it there
   * directly (see `client/lib/media.ts`), so this only answers a caller that
   * asked the route anyway.
   */
  async readMedia(path: string): Promise<MediaContent> {
    // Checked exactly as a write is, so no read reaches the trash or leaves the library.
    this.toKey(path);

    return { redirect: remoteMediaUrl(path, this.config.publicUrl) };
  }

  async beginUpload(path: string, size: number, overwrite: boolean): Promise<UploadTicket> {
    const key = this.toKey(path);
    const presigned = await this.store.presignUpload(key, this.terms(path, size, overwrite));

    // A store that cannot sign takes the bytes through the route instead, where
    // they are checked as they arrive.
    if (!presigned) return { direct: false };

    // No check on the destination here: the precondition is signed into the URL,
    // so the store refuses an occupied key as the browser writes it, and the
    // admin says so from that refusal. A HEAD first would cost a round trip on
    // every upload to reach the same answer slightly sooner.
    return { direct: true, ...presigned };
  }

  /** The proxied path: bytes this server is holding, so its own count is the terms. */
  async uploadMedia(path: string, bytes: Uint8Array<ArrayBuffer>, overwrite: boolean): Promise<void> {
    const key = this.toKey(path);

    await this.assertWritable(key, path, overwrite);
    await this.store.put(key, streamOf(bytes), this.terms(path, bytes.byteLength, overwrite));
  }

  async renameMedia(from: string, to: string): Promise<void> {
    const source = this.toKey(from);
    const target = this.toKey(to);

    // Unlike an upload, a rename has no browser to read the store's refusal, so
    // the conflict is named here; `ifAbsent` on the copy is what makes it true,
    // since a destination can appear between the two calls.
    await this.assertWritable(target, to, false);
    await this.store.copy(source, target, true);
    await this.store.remove(source);
  }

  async deleteMedia(path: string): Promise<void> {
    const key = this.toKey(path);

    // Conditional, so a second deletion within the same millisecond refuses
    // rather than replacing the first one's copy.
    await this.store.copy(key, `${this.config.prefix}${trashId(path, Date.now())}`, true);
    await this.store.remove(key);
  }

  /** Newest first, since a restore is nearly always undoing the last thing done. */
  async listTrash(): Promise<TrashedFile[]> {
    const objects = await this.store.list(`${this.config.prefix}${TRASH_SEGMENT}/`);

    return objects
      .map(({ key, size }) => {
        const id = key.slice(this.config.prefix.length);
        const parsed = parseTrashId(id);

        return parsed && { id, size, ...parsed };
      })
      .filter((file) => file !== null)
      .sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async restoreMedia(id: string): Promise<void> {
    const { path } = this.parsed(id);
    // Back through the same admission every write takes: an extension the
    // library no longer allows does not get in by way of the trash.
    const key = this.toKey(path);

    // Conditional, so restoring onto a name taken since the deletion refuses in
    // the store rather than quietly replacing the newer file.
    try {
      await this.store.copy(`${this.config.prefix}${id}`, key, true);
    } catch (err) {
      await this.assertWritable(key, path, false);

      throw err;
    }

    await this.store.remove(`${this.config.prefix}${id}`);
  }

  async purgeTrash(id: string): Promise<void> {
    this.parsed(id);

    await this.store.remove(`${this.config.prefix}${id}`);
  }

  /** A trash id the library actually issued, rather than any key a caller spells. */
  private parsed(id: string): { path: string; deletedAt: number } {
    const parsed = parseTrashId(id);

    if (!parsed) throw new HttpError(`"${id}" is not a deleted file.`, 400);

    return parsed;
  }
}

const streamOf = (bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> => new Blob([bytes]).stream();
