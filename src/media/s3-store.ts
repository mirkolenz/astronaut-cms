/**
 * The object store a media library lives in, reached through its S3 API with
 * plain `fetch` requests signed by `aws4fetch`, which is small enough to load
 * with the route itself.
 */
import { getSecret } from "astro:env/server";
import { AwsClient } from "aws4fetch";
import { z } from "zod";
import { ApiError } from "@/server/errors";
import {
  encodeKeyPath,
  remoteMediaUrl,
  S3_ACCESS_KEY_ID_ENV,
  S3_SECRET_ACCESS_KEY_ENV,
  S3_SESSION_TOKEN_ENV,
  s3BaseUrl,
  type S3Target,
} from "@/shared/media";
import { parseXml, xmlList } from "@/shared/xml";

/**
 * What an upload is allowed to be, decided by the route and never by its caller.
 * Every one of these is signed into the upload URL, so the store enforces it
 * rather than a check around it: the length because the URL is signed for it,
 * the type because the store serves back what it was given, the disposition
 * because it is what stops an uploaded SVG from becoming a page of its own, and
 * the precondition because a destination checked beforehand can be taken in
 * between.
 */
export interface UploadTerms {
  /** Exact byte count. */
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

/** The store as the library uses it, an interface so tests can stand in for it. */
export interface MediaStore {
  list(prefix: string): Promise<StoredObject[]>;
  head(key: string): Promise<StoredObject | null>;
  /**
   * A URL the browser may PUT these exact terms to. The terms are signed into
   * it, so a declared size is a promise the caller has to keep rather than a
   * number to be trusted, an upload cannot choose how the store will serve it
   * back, and an occupied destination is refused by the store as the write
   * happens.
   */
  presignUpload(key: string, terms: UploadTerms): Promise<PresignedUpload>;
  /** `ifAbsent` refuses a destination that already exists, in the store rather than in a prior check. */
  copy(from: string, to: string, ifAbsent?: boolean): Promise<void>;
  remove(key: string): Promise<void>;
}

/** How long a presigned upload URL stays valid. Long enough for a slow upload of a large file. */
const UPLOAD_EXPIRY_SECONDS = 900;

const MAX_KEYS = 1000;

/** A key ending in a slash is a directory placeholder some tools write, never a library file. */
const isFileKey = (key: string): boolean => !key.endsWith("/");

/** An entity tag as a version: unquoted, and absent rather than empty. */
const versionOf = (etag: string | undefined): string | undefined =>
  etag?.replace(/^(W\/)?"|"$/g, "") || undefined;

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const ListBucketResult = z.object({
  ListBucketResult: z.object({
    Contents: xmlList(
      z.object({ Key: z.string(), Size: z.coerce.number(), ETag: z.string().optional() }),
    ),
    IsTruncated: z.string().optional(),
    NextContinuationToken: z.string().optional(),
  }),
});

/** A copy answers with either its result or, even after a 200, an error. */
const CopyResponse = z.object({ Error: z.unknown().optional() });

/** The response itself, or an error carrying what the store said. */
async function ensureOk(response: Response, action: string): Promise<Response> {
  if (response.ok) return response;

  throw new ApiError(response.status, `S3 ${action} failed: ${await response.text()}`);
}

export class S3Store implements MediaStore {
  private readonly client: AwsClient;
  private readonly bucket: string;
  /** The bucket's URL, which keys are joined onto. */
  private readonly base: string;

  constructor(target: S3Target, credentials: S3Credentials) {
    this.bucket = target.bucket;
    this.base = s3BaseUrl(target).href;
    // Three attempts rather than aws4fetch's eleven.
    this.client = new AwsClient({
      ...credentials,
      service: "s3",
      region: target.region,
      retries: 2,
    });
  }

  /** The store a library names, with the credential from the server's environment. */
  static fromEnv(target: S3Target): S3Store {
    const accessKeyId = getSecret(S3_ACCESS_KEY_ID_ENV);
    const secretAccessKey = getSecret(S3_SECRET_ACCESS_KEY_ENV);

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `Media storage credentials are missing: set ${S3_ACCESS_KEY_ID_ENV} and ${S3_SECRET_ACCESS_KEY_ENV}.`,
      );
    }

    return new S3Store(target, {
      accessKeyId,
      secretAccessKey,
      sessionToken: getSecret(S3_SESSION_TOKEN_ENV),
    });
  }

  private url(key: string): URL {
    return new URL(remoteMediaUrl(key, this.base));
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let cursor: string | undefined;

    do {
      const query = {
        "list-type": "2",
        prefix: prefix || undefined,
        "continuation-token": cursor,
        "max-keys": String(MAX_KEYS),
      };
      const url = new URL(this.base);
      // Encoded by hand, since `URLSearchParams` writes a space as `+`, which stores read inconsistently.
      url.search = Object.entries(query)
        .flatMap(([name, value]) =>
          value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`],
        )
        .join("&");

      const response = await ensureOk(await this.client.fetch(url), `list of "${prefix}"`);
      const { ListBucketResult: result } = parseXml(await response.text(), ListBucketResult);

      for (const { Key: key, Size: size, ETag: etag } of result.Contents) {
        if (key && isFileKey(key)) objects.push({ key, size, version: versionOf(etag) });
      }

      cursor = result.IsTruncated === "true" ? result.NextContinuationToken : undefined;
    } while (cursor);

    return objects;
  }

  async head(key: string): Promise<StoredObject | null> {
    const response = await this.client.fetch(this.url(key), { method: "HEAD" });

    if (response.status === 404) return null;

    await ensureOk(response, `HEAD ${key}`);

    return {
      key,
      size: Number(response.headers.get("content-length") ?? 0),
      version: versionOf(response.headers.get("etag") ?? undefined),
    };
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
   * A type a browser would run as a document gets `Content-Disposition:
   * attachment` signed in too, which the store keeps and serves back.
   */
  async presignUpload(key: string, terms: UploadTerms): Promise<PresignedUpload> {
    // Signed, so the store applies it; sent back for the browser to reproduce,
    // since a signed header the request omits invalidates the signature.
    const headers = {
      "content-type": terms.contentType,
      ...(terms.attachment && { "content-disposition": "attachment" }),
      ...(terms.ifAbsent && { "if-none-match": "*" }),
    };

    const url = this.url(key);
    url.searchParams.set("X-Amz-Expires", String(UPLOAD_EXPIRY_SECONDS));

    const signed = await this.client.sign(url, {
      method: "PUT",
      // `content-length` is set by the browser from the body itself, so it is
      // signed but never listed in `headers` for the caller to send.
      headers: { ...headers, "content-length": String(terms.length) },
      // aws4fetch otherwise skips `content-type` and `content-length`, the two
      // terms that matter most. Only the headers given here are signed.
      aws: { signQuery: true, allHeaders: true },
    });

    return { url: signed.url, headers };
  }

  async copy(from: string, to: string, ifAbsent = false): Promise<void> {
    const response = await this.client.fetch(this.url(to), {
      method: "PUT",
      headers: {
        // Parsed, not decoded, so the key has to arrive encoded.
        "x-amz-copy-source": `${this.bucket}/${encodeKeyPath(from)}`,
        // Conditional in the store, so two renames onto one destination cannot
        // both pass a prior existence check and the second silently win.
        ...(ifAbsent && { "if-none-match": "*" }),
      },
    });
    const body = await (await ensureOk(response, `copy of ${from} to ${to}`)).text();

    // A copy can fail after the store has already answered 200.
    if (body && parseXml(body, CopyResponse).Error !== undefined) {
      throw new Error(`S3 copy of ${from} to ${to} failed: ${body}`);
    }
  }

  async remove(key: string): Promise<void> {
    await ensureOk(await this.client.fetch(this.url(key), { method: "DELETE" }), `DELETE ${key}`);
  }
}
