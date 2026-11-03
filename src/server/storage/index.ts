import { client, components, server as serverConfig } from "virtual:astronaut-cms/server";
import { LocalStorage } from "virtual:astronaut-cms/local-storage";
import { GitHubStorage } from "@/server/storage/github";
import { GitLabStorage } from "@/server/storage/gitlab";
import type { StorageBase, StorageOptions } from "@/server/storage/base";
import { unreachable } from "@/shared/unreachable";
import { mediaLibrary, type MediaLibraryId, type WorkingTreeLibrary } from "@/shared/media";
import type { Session } from "@/server/session";

/**
 * The backend for one request, built from the session that request carries.
 *
 * Constructed per request on purpose. A serverless instance is shared between
 * editors or discarded between clicks, so a backend that outlived a request
 * would either leak one editor's token into another's call or cache a listing
 * nobody can trust. Everything it memoizes (the repository tree, whether the
 * draft branch exists) is therefore scoped to the request that needs it.
 */
export function createStorage(session: Session, library: MediaLibraryId = "repo"): StorageBase {
  const { storage } = serverConfig;
  const options: StorageOptions = {
    collections: client.collections,
    media: client.media,
    library: workingTreeLibrary(library),
    components,
    login: session.login,
  };

  switch (storage.type) {
    case "github":
      return new GitHubStorage(storage, options, session.token);

    case "gitlab":
      return new GitLabStorage(storage, options, session.token);

    case "local":
      // Present exactly when the integration built for a dev run; every other
      // build resolves the virtual module to a stub so `node:fs` stays out.
      if (!LocalStorage) throw new Error("Local storage is only available in `astro dev`.");

      return new LocalStorage(storage, options);

    default:
      return unreachable(storage, "Unknown storage type");
  }
}

/**
 * The library a backend instance serves from the working tree or repository:
 * the repository library, or the object store's stand-in during a dev run.
 */
function workingTreeLibrary(id: MediaLibraryId): WorkingTreeLibrary {
  const library = mediaLibrary(client.media, id);

  if (library.directory == null)
    throw new Error(`The ${id} media library is not kept in the project.`);

  return { ...library, directory: library.directory };
}
