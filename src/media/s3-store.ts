/**
 * The S3 implementation of {@link MediaStore}: plain `fetch` requests signed
 * with `aws4fetch`, which is small enough to load with the route itself.
 */
import { AwsClient } from "aws4fetch";
import { ApiError } from "../server/errors.ts";
import { encodeKeyPath, remoteMediaUrl, s3BaseUrl } from "../shared/media.ts";
import { parseXml } from "../shared/xml.ts";
import {
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

const xmlText = (element: Element, name: string): string | undefined =>
  element.getElementsByTagNameNS("*", name).item(0)?.textContent ?? undefined;

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
    this.client = new AwsClient({ ...credentials, service: "s3", region: target.region, retries: 2 });
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
        .flatMap(([name, value]) => (value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`]))
        .join("&");

      const response = await ensureOk(await this.client.fetch(url), `list of "${prefix}"`);
      const xml = parseXml(await response.text());

      for (const entry of Array.from(xml.getElementsByTagNameNS("*", "Contents"))) {
        const key = xmlText(entry, "Key");

        if (!key || !isFileKey(key)) continue;

        objects.push({ key, size: Number(xmlText(entry, "Size") ?? 0), version: versionOf(xmlText(entry, "ETag")) });
      }

      const root = xml.documentElement;
      cursor = root && xmlText(root, "IsTruncated") === "true"
        ? xmlText(root, "NextContinuationToken")
        : undefined;
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

  async put(key: string, stream: ReadableStream<Uint8Array>, terms: UploadTerms): Promise<void> {
    const request = await this.client.sign(this.url(key), {
      method: "PUT",
      body: stream,
      headers: {
        "content-type": terms.contentType,
        "content-length": String(terms.length),
        ...(terms.attachment && { "content-disposition": "attachment" }),
        ...(terms.ifAbsent && { "if-none-match": "*" }),
      },
    });

    // Sent once, since a stream cannot be replayed for a retry.
    await ensureOk(await fetch(request), `PUT ${key}`);
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
    if (body && parseXml(body).getElementsByTagNameNS("*", "Error").length > 0) {
      throw new Error(`S3 copy of ${from} to ${to} failed: ${body}`);
    }
  }

  async remove(key: string): Promise<void> {
    await ensureOk(await this.client.fetch(this.url(key), { method: "DELETE" }), `DELETE ${key}`);
  }
}
