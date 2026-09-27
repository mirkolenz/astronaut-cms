/**
 * Everything one request is allowed to touch, assembled from the session it
 * carries. An operation receives this and nothing else, so it cannot reach a
 * credential, an environment variable or a store the request did not earn.
 */
import serverConfig from "virtual:astronaut-cms/server";
import type { BindingReader, EnvReader } from "../shared/runtime-env.ts";
import { openStore } from "../media/open-store.ts";
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
   * means reading credentials and, on a cold instance, importing the AWS SDK —
   * and most requests, the assistant's above all, never touch media at all.
   */
  media: () => Promise<MediaBackend>;
}

/**
 * The media library for this request. A repository library *is* the storage
 * backend, so the two are the same object; an object store is a separate one,
 * and the storage backend is then told which library to validate references
 * against.
 */
async function openLibrary(
  storage: StorageBase,
  getEnv: EnvReader,
  getBinding: BindingReader,
): Promise<MediaBackend> {
  const { media } = serverConfig;

  if (!media) return storage;

  const library = new ObjectStoreLibrary(await openStore(media, getEnv, getBinding), media, {
    extensions: serverConfig.mediaExtensions,
    maxFileSize: serverConfig.maxFileSize,
  });

  storage.useMediaSource(library);

  return library;
}

export function createContext(
  session: Session,
  getEnv: EnvReader,
  getBinding: BindingReader,
): RequestContext {
  const storage = createStorage(session);
  let library: Promise<MediaBackend> | null = null;

  return {
    session,
    storage,
    media: () => (library ??= openLibrary(storage, getEnv, getBinding)),
  };
}
