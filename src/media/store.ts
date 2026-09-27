/**
 * The object store as the media route uses it. The S3 implementation lives in
 * `s3-store.ts` and is loaded on demand, so a deployment reaching R2 through a
 * Workers binding never pays for the AWS SDK.
 */

/**
 * What an upload is allowed to be, decided by the route and never by its caller.
 * All three are enforced by the store itself: the length because a presigned URL
 * is signed for it, the type because the store serves back what it was given,
 * and the disposition because it is what stops an uploaded SVG from becoming a
 * page of its own.
 */
export interface UploadTerms {
  /** Exact byte count. A stream carries none of its own, and S3 refuses one without it. */
  length: number;
  /** Derived from the file's extension by `mediaContentType`. */
  contentType: string;
  /** Set for a type a browser would otherwise run as a document. */
  attachment: boolean;
}

/** One object in the library, keyed absolutely (prefix included). */
export interface StoredObject {
  key: string;
  size: number;
}

export interface MediaStore {
  list(prefix: string): Promise<StoredObject[]>;
  head(key: string): Promise<StoredObject | null>;
  /**
   * A URL the browser may PUT these exact terms to, or null when the bytes have
   * to come through the route instead. Length and type are signed into it, so a
   * declared size is a promise the caller has to keep rather than a number to be
   * trusted, and an upload cannot choose how the store will serve it back.
   */
  presignUpload(key: string, terms: UploadTerms): Promise<string | null>;
  put(key: string, stream: ReadableStream<Uint8Array>, terms: UploadTerms): Promise<void>;
  /** `ifAbsent` refuses a destination that already exists, in the store rather than in a prior check. */
  copy(from: string, to: string, ifAbsent?: boolean): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface S3Target {
  endpoint: string;
  region: string;
  pathStyle: boolean;
  bucket: string;
}

/**
 * Origin a presigned PUT against this target points at. Virtual-host addressing
 * puts the bucket in the hostname, so it is the endpoint's origin only when
 * path-style is forced.
 *
 * It lives here, beside the target the SDK is configured from, because the only
 * other place that needs it is the admin's CSP — and a `connect-src` that
 * disagrees with the SDK blocks every upload with no error an operator can read.
 */
export function presignedUploadOrigin(target: S3Target): string {
  const url = new URL(target.endpoint);

  if (!target.pathStyle) url.hostname = `${target.bucket}.${url.hostname}`;

  return url.origin;
}

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** How long a presigned upload URL stays valid. Long enough for a slow upload of a large file. */
export const UPLOAD_EXPIRY_SECONDS = 900;

export const MAX_KEYS = 1000;

/** A key ending in a slash is a directory placeholder some tools write, never a library file. */
export const isFileKey = (key: string): boolean => !key.endsWith("/");

/** Declared structurally so the package needs no Cloudflare types to build. */
export interface R2Binding {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: Array<{ key: string; size: number }>;
    truncated: boolean;
    cursor?: string;
  }>;
  head(key: string): Promise<{ key: string; size: number } | null>;
  get(
    key: string,
  ): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string; contentDisposition?: string };
  } | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ): Promise<unknown>;
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

      objects.push(...page.objects.filter((o) => isFileKey(o.key)));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    return objects;
  }

  async head(key: string): Promise<StoredObject | null> {
    return this.bucket.head(key);
  }

  /** A binding cannot delegate the upload, so the route takes the bytes itself. */
  async presignUpload(): Promise<null> {
    return null;
  }

  async put(key: string, stream: ReadableStream<Uint8Array>, terms: UploadTerms): Promise<void> {
    await this.bucket.put(key, stream, { httpMetadata: httpMetadata(terms) });
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
    await this.bucket.put(to, source.body, {
      httpMetadata: source.httpMetadata,
      ...(ifAbsent && { onlyIf: { etagDoesNotMatch: "*" } }),
    });
  }

  async remove(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
