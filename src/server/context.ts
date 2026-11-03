/**
 * Everything one request is allowed to touch, assembled from the session it
 * carries. An operation receives this and nothing else, so it cannot reach a
 * credential, an environment variable or a store the request did not earn.
 */
import { client, server as serverConfig } from "virtual:astronaut-cms/server";
import { S3Store } from "@/media/s3-store";
import { ObjectStoreLibrary } from "@/server/media";
import { HttpError } from "@/server/errors";
import { createStorage } from "@/server/storage";
import type { MediaBackend, StorageBackend } from "@/server/storage/types";
import type { StorageBase } from "@/server/storage/base";
import type { Session } from "@/server/session";
import type { MediaLibraryId } from "@/shared/media";

export interface RequestContext {
  session: Session;
  storage: StorageBackend;
  /**
   * One media library: the repository backend itself, or the object store
   * configured beside it.
   *
   * Resolved on first use rather than per request: reaching an object store
   * means reading credentials, and most requests,
   * the assistant's above all, never touch media at all.
   */
  media: (library: MediaLibraryId) => MediaBackend;
}

/**
 * The object store for this request: the bucket, or, in a dev run, a second
 * working-tree backend rooted at the store's dev directory.
 */
function openObjectStore(session: Session): MediaBackend {
  const s3 = client.media.s3;

  if (!s3) throw new HttpError("No object-store media library is configured.", 404);

  if (s3.directory != null) return createStorage(session, "s3");

  // Only a dev run leaves the server without the store, and it took the branch above.
  if (!serverConfig.media) throw new Error("The object store is not configured for this server.");

  return new ObjectStoreLibrary(S3Store.fromEnv(serverConfig.media.s3), serverConfig.media, s3);
}

export function createContext(session: Session): RequestContext {
  const storage: StorageBase = createStorage(session);
  let objectStore: MediaBackend | null = null;
  const media = (library: MediaLibraryId): MediaBackend =>
    library === "repo" ? storage : (objectStore ??= openObjectStore(session));

  // A repository library *is* the storage backend; entry validation checks an
  // object-store reference against the store's own listing.
  storage.useMediaLibraries(media);

  return { session, storage, media };
}
