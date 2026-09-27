/**
 * The only module that needs `@aws-sdk/client-s3`, an optional peer dependency,
 * which is why the route imports it lazily (see `handler.ts`).
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { encodeKeyPath } from "../shared/media.ts";
import {
  isFileKey,
  MAX_KEYS,
  UPLOAD_EXPIRY_SECONDS,
  type MediaStore,
  type UploadBody,
  type S3Credentials,
  type S3Target,
  type StoredObject,
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

        objects.push({ key: object.Key, size: object.Size ?? 0 });
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

      return { key, size: object.ContentLength ?? 0 };
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound") return null;

      throw err;
    }
  }

  /**
   * Bytes go browser-to-store, so an upload is not bounded by the platform's
   * request-body limit (4.5 MB on Vercel, 6 MB on Netlify). The content type is
   * left unsigned: signing it would only turn a mismatched guess into a failure.
   */
  presignUpload(key: string): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: UPLOAD_EXPIRY_SECONDS,
    });
  }

  async put(key: string, body: UploadBody, contentType: string | null): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body.stream,
        ContentType: contentType ?? undefined,
        ContentLength: body.length,
      }),
    );
  }

  async copy(from: string, to: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: to,
        // `CopySource` is parsed, not decoded, so the key arrives encoded; the SDK does not do it.
        CopySource: `${this.bucket}/${encodeKeyPath(from)}`,
      }),
    );
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
