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
  isActiveContentType,
  mediaContentType,
  S3_ACCESS_KEY_ID_ENV,
  S3_SECRET_ACCESS_KEY_ENV,
  S3_SESSION_TOKEN_ENV,
  type UploadTarget,
} from "../shared/media.ts";
import type { MediaFile } from "../shared/types.ts";
import type { MediaServerConfig } from "../integration/types.ts";
import { BindingStore, type MediaStore, type R2Binding, type UploadTerms } from "./store.ts";

/**
 * Where a deleted object is kept instead of being dropped.
 *
 * What may safely be deleted depends on what content references it, and only
 * the admin can answer that — it is the side that can read the repository. A
 * precondition the store cannot check is no precondition at all, so the store
 * makes the operation recoverable instead: a client bug, a stale reference scan
 * or a compromised admin then costs a restore rather than the file.
 *
 * It lives inside the library prefix so one bucket policy covers both, under a
 * segment `toKey` refuses, so nothing reachable through this route can address
 * it. Give the prefix a lifecycle rule to decide how long a deletion stays
 * undoable — and note that a public bucket serves these keys too, so a deleted
 * file stays readable to anyone who can guess one until that rule expires it.
 */
const TRASH_SEGMENT = ".trash";

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
  | { action: "upload"; path: string; size: number; overwrite?: boolean }
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

  if (path.split("/")[0] === TRASH_SEGMENT) {
    throw new RequestError(`"${TRASH_SEGMENT}" is reserved.`, 400);
  }

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

/**
 * What an upload is allowed to be. Settled here rather than taken from the
 * request: the caller names a path and a size, and everything that decides how
 * the bytes are stored and served back follows from the path alone.
 */
function uploadTerms(path: string, size: number, maxFileSize: number | null): UploadTerms {
  checked(413, () => assertWithinSizeLimit(size, maxFileSize));

  const contentType = mediaContentType(path);

  return { length: size, contentType, attachment: isActiveContentType(contentType) };
}

/**
 * A destination the caller is entitled to write. A presigned PUT replaces
 * whatever is at its key, so a write that did not say it meant to replace must
 * never be handed one that can. This is the only place that decides it: the
 * admin's own check is a courtesy, and the assistant's unique naming is one
 * caller's discipline rather than a rule of the library.
 */
async function assertWritable(
  store: MediaStore,
  key: string,
  path: string,
  overwrite: boolean,
): Promise<void> {
  if (overwrite || !(await store.head(key))) return;

  throw new RequestError(
    `A file already exists at "${path}". Use a different name, or replace it deliberately.`,
    409,
  );
}

async function upload(
  body: Extract<MediaAction, { action: "upload" }>,
  { media, extensions, maxFileSize }: ResolvedConfig,
  store: MediaStore,
): Promise<UploadTarget> {
  const { size } = body;

  if (!Number.isFinite(size) || size < 0) {
    throw new RequestError("An upload size is required.", 400);
  }

  const key = toKey(body.path, media, extensions);
  const url = await store.presignUpload(key, uploadTerms(body.path, size, maxFileSize));

  // The client is told which it is, so it never sends the Git token to a store.
  // A proxied upload is checked when its bytes arrive; only a presigned URL is
  // handed out now and spent later, so its destination has to be settled here.
  if (!url) return { proxy: true };

  await assertWritable(store, key, body.path, body.overwrite === true);

  return { proxy: false, url, contentType: mediaContentType(body.path) };
}

async function run(
  body: MediaAction,
  config: ResolvedConfig,
  store: MediaStore,
): Promise<Response> {
  const { media, extensions } = config;
  const key = (path: unknown) => toKey(path, media, extensions);

  switch (body.action) {
    case "list": {
      const objects = await store.list(media.prefix);
      const files: MediaFile[] = objects
        .map(({ key: objectKey, size }) => ({ path: objectKey.slice(media.prefix.length), size }))
        .filter(
          (file) =>
            !file.path.startsWith(`${TRASH_SEGMENT}/`) &&
            hasAllowedExtension(file.path, extensions),
        );

      return json({ files });
    }

    case "upload":
      return json(await upload(body, config, store));

    case "rename": {
      const from = key(body.from);
      const to = key(body.to);

      // The check reports the conflict; `ifAbsent` is what makes it true, since
      // a destination can appear between the two calls.
      await assertWritable(store, to, body.to, false);
      await store.copy(from, to, true);
      await store.remove(from);

      return json({ ok: true });
    }

    case "delete": {
      const from = key(body.path);

      await store.copy(from, `${media.prefix}${TRASH_SEGMENT}/${Date.now()}-${body.path}`);
      await store.remove(from);

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
      const params = new URL(request.url).searchParams;
      const path = params.get("path") ?? "";
      const length = Number(request.headers.get("content-length"));

      // The store needs the length to accept a stream, so an upload that does not
      // declare one cannot be forwarded at all. Here it is the measured length of
      // the body this route is holding, not a number the caller asserted.
      if (!request.body || !Number.isFinite(length) || length <= 0) {
        throw new RequestError("Upload requires a content-length.", 411);
      }

      const key = toKey(path, media, config.extensions);

      await assertWritable(store, key, path, params.get("overwrite") === "true");

      // Streamed rather than buffered: an isolate has far less memory than the
      // platform allows a request body to be (128 MB against 100-500 MB). The
      // caller's own content-type is discarded: `uploadTerms` derives it.
      await store.put(key, request.body, uploadTerms(path, length, config.maxFileSize));

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
