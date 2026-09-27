/**
 * Everything one request is allowed to touch, assembled from the session it
 * carries. An operation receives this and nothing else, so it cannot reach a
 * credential, an environment variable or a store the request did not earn.
 */
import { server as serverConfig } from "virtual:astronaut-cms/server";
import { S3Store } from "../media/s3-store.ts";
import { ObjectStoreLibrary } from "./media.ts";
import { createStorage } from "./storage/index.ts";
import type { MediaBackend, StorageBackend } from "./storage/types.ts";
import type { StorageBase } from "./storage/base.ts";
import type { Session } from "./session.ts";

export interface RequestContext {
  session: Session;
  storage: StorageBackend;
  /**
   * The repository backend itself, or the object store configured beside it.
   *
   * Resolved on first use rather than per request: reaching an object store
   * means reading credentials, and most requests,
   * the assistant's above all, never touch media at all.
   */
  media: () => MediaBackend;
}

/**
 * The media library for this request. A repository library *is* the storage
 * backend, so the two are the same object; an object store is a separate one,
 * and the storage backend is then told which library to validate references
 * against.
 */
function openLibrary(storage: StorageBase): MediaBackend {
  const { media } = serverConfig;

  if (!media) return storage;

  const library = new ObjectStoreLibrary(S3Store.fromEnv(media.s3), media, {
    extensions: serverConfig.mediaExtensions,
    maxFileSize: serverConfig.maxFileSize,
  });

  storage.useMediaSource(library);

  return library;
}

export function createContext(session: Session): RequestContext {
  const storage = createStorage(session);
  let library: MediaBackend | null = null;

  return {
    session,
    storage,
    media: () => (library ??= openLibrary(storage)),
  };
}
