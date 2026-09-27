/**
 * The object store as the media route uses it. The S3 implementation lives in
 * `s3-store.ts` and is loaded on demand, so a deployment reaching R2 through a
 * Workers binding never pays for the AWS SDK.
 */

/**
 * Bytes on their way into the store. The length travels with them because a
 * stream has none of its own and the S3 API refuses one without it.
 */
export interface UploadBody {
  stream: ReadableStream<Uint8Array>;
  length: number;
}

/** One object in the library, keyed absolutely (prefix included). */
export interface StoredObject {
  key: string;
  size: number;
}

export interface MediaStore {
  list(prefix: string): Promise<StoredObject[]>;
  head(key: string): Promise<StoredObject | null>;
  /** A URL the browser may PUT the bytes to, or null when they must be proxied. */
  presignUpload(key: string): Promise<string | null>;
  put(key: string, body: UploadBody, contentType: string | null): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface S3Target {
  endpoint: string;
  region: string;
  pathStyle: boolean;
  bucket: string;
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
  ): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
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

  async put(key: string, body: UploadBody, contentType: string | null): Promise<void> {
    await this.bucket.put(key, body.stream, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
  }

  async copy(from: string, to: string): Promise<void> {
    const source = await this.bucket.get(from);

    if (!source) throw new Error(`Object not found: ${from}`);

    // A rewrite, unlike an S3 copy, keeps nothing on its own: without this the
    // renamed object loses its content type and the CDN serves it as a download.
    await this.bucket.put(to, source.body, { httpMetadata: source.httpMetadata });
  }

  async remove(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
