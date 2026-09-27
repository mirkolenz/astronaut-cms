import { client, components, server as serverConfig } from "virtual:astronaut-cms/server";
import { LocalStorage } from "virtual:astronaut-cms/local-storage";
import type { StorageBackend } from "./types.ts";
import { GitHubStorage } from "./github.ts";
import { GitLabStorage } from "./gitlab.ts";
import type { StorageBase, StorageOptions } from "./base.ts";
import { unreachable } from "../../shared/unreachable.ts";
import type { Session } from "../session.ts";

export type { StorageBackend };

/**
 * The backend for one request, built from the session that request carries.
 *
 * Constructed per request on purpose. A serverless instance is shared between
 * editors or discarded between clicks, so a backend that outlived a request
 * would either leak one editor's token into another's call or cache a listing
 * nobody can trust. Everything it memoizes (the repository tree, whether the
 * draft branch exists) is therefore scoped to the request that needs it.
 */
export function createStorage(session: Session): StorageBase {
  const { storage } = serverConfig;
  const options: StorageOptions = {
    collections: client.collections,
    mediaDirectory: serverConfig.mediaDirectory,
    mediaExtensions: serverConfig.mediaExtensions,
    maxFileSize: serverConfig.maxFileSize,
    mediaBackend: client.mediaBackend,
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
