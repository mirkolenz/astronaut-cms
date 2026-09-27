/**
 * The only module that needs `@aws-sdk/client-s3`, an optional peer dependency,
 * which is why the route imports it lazily (see `handler.ts`).
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { encodeKeyPath } from "../shared/media.ts";
import {
  DOWNLOAD_EXPIRY_SECONDS,
  isFileKey,
  MAX_KEYS,
  UPLOAD_EXPIRY_SECONDS,
  type MediaStore,
  type PresignedUpload,
  type UploadTerms,
  type S3Credentials,
  type S3Target,
  type StoredObject,
  versionOf,
} from "./store.ts";

export class S3Store implements MediaStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(target: S3Target, credentials: S3Credentials) {
    this.bucket = target.bucket;
    this.client = new S3Client({
      endpoint: target.endpoint,
      region: target.region,
      forcePathStyle: target.pathStyle,
      credentials,
      // The SDK otherwise adds a CRC32 checksum to every request, which
      // S3-compatible stores reject and which a presigned URL would force the
      // browser to reproduce exactly.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix || undefined,
          ContinuationToken: cursor,
          MaxKeys: MAX_KEYS,
        }),
      );

      for (const object of page.Contents ?? []) {
        if (!object.Key || !isFileKey(object.Key)) continue;

        objects.push({ key: object.Key, size: object.Size ?? 0, version: versionOf(object.ETag) });
      }

      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (cursor);

    return objects;
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return { key, size: object.ContentLength ?? 0, version: versionOf(object.ETag) };
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound") return null;

      throw err;
    }
  }

  /**
   * Bytes go browser-to-store, so an upload is not bounded by the platform's
   * request-body limit (4.5 MB on Vercel, 6 MB on Netlify). Every term is signed
   * into the URL, which is what makes the route's decisions bind the upload the
   * browser actually makes rather than merely precede it: the URL is usable for
   * that byte count, that type and that precondition and no other. A caller can
   * neither understate a file's size to get an unrestricted PUT, nor choose how
   * the store will serve the bytes back, nor take a destination the route
   * refused it.
   *
   * A type a browser would run as a document needs a `Content-Disposition` the
   * store will keep, and there is no request header for one to be signed into.
   * Those uploads are proxied instead, where the route sets it directly.
   */
  async presignUpload(key: string, terms: UploadTerms): Promise<PresignedUpload | null> {
    if (terms.attachment) return null;

    // Signed, so the store applies it; sent back for the browser to reproduce,
    // since a signed header the request omits invalidates the signature.
    const headers = {
      "content-type": terms.contentType,
      ...(terms.ifAbsent && { "if-none-match": "*" }),
    };

    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentLength: terms.length,
        ContentType: terms.contentType,
        ...(terms.ifAbsent && { IfNoneMatch: "*" }),
      }),
      {
        expiresIn: UPLOAD_EXPIRY_SECONDS,
        // `content-length` is set by the browser from the body itself, so it is
        // signed but never listed here for the caller to send.
        signableHeaders: new Set(["content-length", ...Object.keys(headers)]),
      },
    );

    return { url, headers };
  }

  /**
   * Nothing is signed but the key: a read carries no terms to bind, and the URL
   * is handed to a browser or to astro's image pipeline, which sends a plain GET.
   */
  presignDownload(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: DOWNLOAD_EXPIRY_SECONDS,
    });
  }

  async put(key: string, stream: ReadableStream<Uint8Array>, terms: UploadTerms): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: terms.contentType,
        ContentLength: terms.length,
        ...(terms.attachment && { ContentDisposition: "attachment" }),
        ...(terms.ifAbsent && { IfNoneMatch: "*" }),
      }),
    );
  }

  async copy(from: string, to: string, ifAbsent = false): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: to,
        // `CopySource` is parsed, not decoded, so the key arrives encoded; the SDK does not do it.
        CopySource: `${this.bucket}/${encodeKeyPath(from)}`,
        // Conditional in the store, so two renames onto one destination cannot
        // both pass a prior existence check and the second silently win.
        ...(ifAbsent && { IfNoneMatch: "*" }),
      }),
    );
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
