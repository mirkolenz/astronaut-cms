/**
 * Platform-agnostic media route: the one place a bucket credential may exist,
 * gated by the same write-access check as the AI relay. Upload bytes do not pass
 * through it — the store presigns a URL the browser uses directly — except for a
 * Workers binding, which cannot sign (see `PUT`). `endpoint.ts` is the astro
 * shell over it.
 */
import { denyUnlessWritable, type AccessConfig } from "../shared/access.ts";
import { json, jsonError } from "../shared/response.ts";
import { validateMediaPath } from "../shared/validation.ts";
import type { BindingReader, EnvReader } from "../shared/runtime-env.ts";
import {
  assertWithinSizeLimit,
  hasAllowedExtension,
  S3_ACCESS_KEY_ID_ENV,
  S3_SECRET_ACCESS_KEY_ENV,
  S3_SESSION_TOKEN_ENV,
  type UploadTarget,
} from "../shared/media.ts";
import type { MediaFile } from "../shared/types.ts";
import type { MediaServerConfig } from "../integration/types.ts";
import { BindingStore, type MediaStore, type R2Binding } from "./store.ts";

export interface MediaRelayConfig extends AccessConfig {
  /** Null when the library lives in the repository, where this route has no role. */
  media: MediaServerConfig | null;
  /** The extensions the library accepts, enforced again here rather than trusted. */
  extensions: string[];
  /** Upload size limit in bytes, or null for unlimited. */
  maxFileSize: number | null;
}

type MediaAction =
  | { action: "list" }
  | { action: "upload"; path: string; size?: number }
  | { action: "rename"; from: string; to: string }
  | { action: "delete"; path: string };

class RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// An S3 client carries a keep-alive connection pool, so a warm instance reuses
// one rather than reconnecting per request. Bindings are request-scoped and stay out.
let cached: { key: string; store: MediaStore } | null = null;

async function s3Store(media: MediaServerConfig, getEnv: EnvReader): Promise<MediaStore> {
  if (!media.s3) throw new RequestError("The media backend is not configured.", 500);

  const accessKeyId = getEnv(S3_ACCESS_KEY_ID_ENV);
  const secretAccessKey = getEnv(S3_SECRET_ACCESS_KEY_ENV);

  if (!accessKeyId || !secretAccessKey) {
    throw new RequestError(
      `Media storage credentials are missing: set ${S3_ACCESS_KEY_ID_ENV} and ${S3_SECRET_ACCESS_KEY_ENV}.`,
      500,
    );
  }

  const sessionToken = getEnv(S3_SESSION_TOKEN_ENV);
  const key = JSON.stringify([media.s3, media.bucket, accessKeyId, secretAccessKey, sessionToken]);

  if (cached?.key !== key) {
    const { S3Store } = await import("./s3-store.ts");

    cached = {
      key,
      store: new S3Store(
        { ...media.s3, bucket: media.bucket },
        { accessKeyId, secretAccessKey, sessionToken },
      ),
    };
  }

  return cached.store;
}

/**
 * A Workers binding is preferred where available, since it needs no credential.
 * The S3 module is imported only on the other path, so a binding never loads the SDK.
 */
async function openStore(
  media: MediaServerConfig,
  getEnv: EnvReader,
  getBinding: BindingReader,
): Promise<MediaStore> {
  if (!media.binding) return s3Store(media, getEnv);

  const binding = getBinding(media.binding);

  if (binding) return new BindingStore(binding as R2Binding);

  if (!media.s3) {
    throw new RequestError(
      `The R2 binding "${media.binding}" is not available in this runtime, and no accountId is configured to fall back to the S3 API.`,
      500,
    );
  }

  return s3Store(media, getEnv);
}

/** A library path, checked and lowered to the store key it addresses. */
function toKey(path: unknown, media: MediaServerConfig, extensions: string[]): string {
  if (typeof path !== "string") throw new RequestError("A media path is required.", 400);

  checked(400, () => validateMediaPath(path));

  if (!hasAllowedExtension(path, extensions)) {
    throw new RequestError(
      `"${path}" does not have an allowed media extension (${extensions.join(", ")}).`,
      400,
    );
  }

  return `${media.prefix}${path}`;
}

/** Runs a check that throws a plain Error, and gives its failure an HTTP meaning. */
function checked<T>(status: number, run: () => T): T {
  try {
    return run();
  } catch (err) {
    throw new RequestError(err instanceof Error ? err.message : "Invalid request.", status);
  }
}

/** A relay whose backend is configured, which is all `run` is ever handed. */
type ResolvedConfig = MediaRelayConfig & { media: MediaServerConfig };

async function run(
  body: MediaAction,
  { media, extensions, maxFileSize }: ResolvedConfig,
  store: MediaStore,
): Promise<Response> {
  const key = (path: unknown) => toKey(path, media, extensions);

  switch (body.action) {
    case "list": {
      const objects = await store.list(media.prefix);
      const files: MediaFile[] = objects
        .map(({ key: objectKey, size }) => ({ path: objectKey.slice(media.prefix.length), size }))
        .filter((file) => hasAllowedExtension(file.path, extensions));

      return json({ files });
    }

    case "upload": {
      // A presigned URL enforces nothing, so the size the client declares is all
      // there is to go on until the bytes arrive somewhere this route can see.
      if (body.size != null) checked(413, () => assertWithinSizeLimit(body.size!, maxFileSize));

      const url = await store.presignUpload(key(body.path));

      // The client is told which it is, so it never sends the Git token to a store.
      const target: UploadTarget = url ? { proxy: false, url } : { proxy: true };

      return json(target);
    }

    case "rename": {
      const from = key(body.from);
      const to = key(body.to);

      if (await store.head(to)) {
        throw new RequestError(`A file already exists at "${body.to}".`, 409);
      }

      await store.copy(from, to);
      await store.remove(from);

      return json({ ok: true });
    }

    case "delete": {
      await store.remove(key(body.path));

      return json({ ok: true });
    }

    default:
      throw new RequestError("Unknown media action.", 400);
  }
}

export async function handle(
  request: Request,
  getEnv: EnvReader,
  getBinding: BindingReader,
  config: MediaRelayConfig,
): Promise<Response> {
  const { media } = config;

  if (!media) return jsonError("No object-store media backend is configured.", 500);

  const denied = await denyUnlessWritable(request, config);

  if (denied) return denied;

  try {
    const store = await openStore(media, getEnv, getBinding);

    // A proxied upload carries a body, so it names its target in the query string.
    if (request.method === "PUT") {
      const length = Number(request.headers.get("content-length"));

      // The store needs the length to accept a stream, so an upload that does not
      // declare one cannot be forwarded at all.
      if (!request.body || !Number.isFinite(length) || length <= 0) {
        throw new RequestError("Upload requires a content-length.", 411);
      }

      checked(413, () => assertWithinSizeLimit(length, config.maxFileSize));

      // Streamed rather than buffered: an isolate has far less memory than the
      // platform allows a request body to be (128 MB against 100-500 MB).
      await store.put(
        toKey(new URL(request.url).searchParams.get("path"), media, config.extensions),
        { stream: request.body, length },
        request.headers.get("content-type"),
      );

      return json({ ok: true });
    }

    let body: MediaAction;

    try {
      body = (await request.json()) as MediaAction;
    } catch {
      return jsonError("Malformed request body.", 400);
    }

    return await run(body, { ...config, media }, store);
  } catch (err) {
    if (err instanceof RequestError) return jsonError(err.message, err.status);

    console.error("[astronaut-cms] Media operation failed:", err);

    return jsonError(err instanceof Error ? err.message : "Media operation failed", 500);
  }
}
