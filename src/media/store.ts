import { partialContent, type ByteRange, type PartialContent } from "../shared/http.ts";
import type { S3Target as SharedS3Target } from "../shared/media.ts";

/**
 * The object store as the media route uses it. The S3 implementation lives in
 * `s3-store.ts` and is loaded on demand, so a deployment reaching R2 through a
 * Workers binding never pays for the AWS SDK.
 */

/**
 * What an upload is allowed to be, decided by the route and never by its caller.
 * Every one of these is enforced by the store itself rather than by a check
 * around it: the length because a presigned URL is signed for it, the type
 * because the store serves back what it was given, the disposition because it is
 * what stops an uploaded SVG from becoming a page of its own, and the
 * precondition because a destination checked beforehand can be taken in between.
 */
export interface UploadTerms {
  /** Exact byte count. A stream carries none of its own, and S3 refuses one without it. */
  length: number;
  /** Derived from the file's extension by `mediaContentType`. */
  contentType: string;
  /** Set for a type a browser would otherwise run as a document. */
  attachment: boolean;
  /** Refuses the write if anything is already at the key. Cleared to replace deliberately. */
  ifAbsent: boolean;
}

/**
 * A delegated upload: where the browser may PUT, and the headers it has to send
 * because they are signed into that URL. The browser reproduces them verbatim
 * or the store rejects the signature, which is what makes them terms rather
 * than suggestions.
 */
export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

export type StoreContent =
  | { redirect: string }
  | { body: ReadableStream<Uint8Array> | null; version?: string; partial?: PartialContent };

/** One object in the library, keyed absolutely (prefix included). */
export interface StoredObject {
  key: string;
  size: number;
  /**
   * The store's entity tag for these bytes, which is what lets the library
   * address a file by its contents: the URL changes when the object is
   * replaced, so a browser or a CDN holding the old one stops being asked for
   * it. Absent when the store does not report one.
   */
  version?: string;
}

/** An entity tag as a version: unquoted, and absent rather than empty. */
export const versionOf = (etag: string | undefined): string | undefined =>
  etag?.replace(/^(W\/)?"|"$/g, "") || undefined;

export interface MediaStore {
  list(prefix: string): Promise<StoredObject[]>;
  head(key: string): Promise<StoredObject | null>;
  /**
   * A URL the browser may PUT these exact terms to, or null when the bytes have
   * to come through the route instead. The terms are signed into it, so a
   * declared size is a promise the caller has to keep rather than a number to be
   * trusted, an upload cannot choose how the store will serve it back, and an
   * occupied destination is refused by the store as the write happens.
   */
  presignUpload(key: string, terms: UploadTerms): Promise<PresignedUpload | null>;
  /**
   * The bytes themselves, or a signed URL the browser may read them from. A
   * store handing over bytes cuts `range` itself, so a seek in a large video
   * never streams the whole object through the route.
   */
  read(key: string, range?: ByteRange): Promise<StoreContent | null>;
  put(key: string, stream: ReadableStream<Uint8Array>, terms: UploadTerms): Promise<void>;
  /** `ifAbsent` refuses a destination that already exists, in the store rather than in a prior check. */
  copy(from: string, to: string, ifAbsent?: boolean): Promise<void>;
  remove(key: string): Promise<void>;
}

/** What the SDK is configured from. `region` is signing-only, so it is not in the shared shape. */
export interface S3Target extends SharedS3Target {
  region: string;
}

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** How long a presigned upload URL stays valid. Long enough for a slow upload of a large file. */
export const UPLOAD_EXPIRY_SECONDS = 900;

/**
 * How long a presigned read URL stays valid. Long enough to outlast a build that
 * signs one per referenced image and downloads them as it renders.
 */
export const DOWNLOAD_EXPIRY_SECONDS = 3600;

export const MAX_KEYS = 1000;

/** A key ending in a slash is a directory placeholder some tools write, never a library file. */
export const isFileKey = (key: string): boolean => !key.endsWith("/");

/** Declared structurally so the package needs no Cloudflare types to build. */
export interface R2Binding {
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; size: number; etag?: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  head(key: string): Promise<{ key: string; size: number; etag?: string } | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{
    body: ReadableStream<Uint8Array>;
    etag?: string;
    httpMetadata?: { contentType?: string; contentDisposition?: string };
  } | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ): Promise<{ key: string } | null>;
  delete(key: string): Promise<void>;
}

/** How an object is served back, from the terms the route settled on. */
function httpMetadata({ contentType, attachment }: UploadTerms) {
  return { contentType, ...(attachment && { contentDisposition: "attachment" }) };
}

export class BindingStore implements MediaStore {
  private readonly bucket: R2Binding;

  constructor(bucket: R2Binding) {
    this.bucket = bucket;
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.bucket.list({ prefix, cursor, limit: MAX_KEYS });

      objects.push(
        ...page.objects
          .filter((o) => isFileKey(o.key))
          .map(({ key, size, etag }) => ({ key, size, version: versionOf(etag) })),
      );
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    return objects;
  }

  async head(key: string): Promise<StoredObject | null> {
    const object = await this.bucket.head(key);

    return object && { key: object.key, size: object.size, version: versionOf(object.etag) };
  }

  /** A binding signs nothing, so the route moves the bytes in both directions. */
  async presignUpload(): Promise<null> {
    return null;
  }

  async read(key: string, range?: ByteRange): Promise<StoreContent | null> {
    if (!range) {
      const object = await this.bucket.get(key);

      return object && { body: object.body, version: versionOf(object.etag) };
    }

    // A range is settled against the object's size first, which a head reads
    // without a byte of the body, so the get fetches only what is sent.
    const head = await this.bucket.head(key);

    if (!head) return null;

    const version = versionOf(head.etag);
    const partial = partialContent(range, head.size);

    if (!partial.span) return { body: null, version, partial };

    const { start, end } = partial.span;
    const object = await this.bucket.get(key, { range: { offset: start, length: end - start + 1 } });

    return object && { body: object.body, version, partial };
  }

  async put(key: string, stream: ReadableStream<Uint8Array>, terms: UploadTerms): Promise<void> {
    const stored = await this.bucket.put(key, stream, {
      httpMetadata: httpMetadata(terms),
      ...(terms.ifAbsent && { onlyIf: { etagDoesNotMatch: "*" } }),
    });

    if (!stored) throw new Error(`Object already exists: ${key}`);
  }

  /**
   * A binding has no server-side copy, so the bytes travel through the isolate —
   * which bounds a rename, and the move to `.trash/` that a deletion is, by the
   * Worker's memory rather than by the store's. The S3 path pays neither.
   */
  async copy(from: string, to: string, ifAbsent = false): Promise<void> {
    const source = await this.bucket.get(from);

    if (!source) throw new Error(`Object not found: ${from}`);

    // A rewrite, unlike an S3 copy, keeps nothing on its own: without this the
    // renamed object loses its content type and the CDN serves it as a download.
    const stored = await this.bucket.put(to, source.body, {
      httpMetadata: source.httpMetadata,
      ...(ifAbsent && { onlyIf: { etagDoesNotMatch: "*" } }),
    });

    if (!stored) throw new Error(`Object already exists: ${to}`);
  }

  async remove(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
