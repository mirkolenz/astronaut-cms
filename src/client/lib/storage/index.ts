import config from "virtual:astronaut-cms/config";
import collections from "virtual:astronaut-cms/collections";
import type { StorageBackend } from "./types";
import type { StorageBase } from "./base";
import { LocalStorage } from "./local";
import { GitHubStorage } from "./github";
import { GitLabStorage } from "./gitlab";
import { RemoteMedia } from "@client/lib/media/remote";
import type { MediaBackend } from "@client/lib/media/types";
import { parseRepo } from "@shared/access";

let wired: { storage: StorageBase; media: MediaBackend } | null = null;

function createStorage(): StorageBase {
  const { mediaDirectory } = config;

  switch (config.storageType) {
    case "github": {
      if (!config.github) throw new Error("GitHub config missing");

      const { owner, repo } = parseRepo(config.github.repo);

      return new GitHubStorage(
        {
          owner,
          repo,
          branch: config.github.branch,
          publishMode: config.github.publishMode,
        },
        collections,
        mediaDirectory,
      );
    }

    case "gitlab": {
      if (!config.gitlab) throw new Error("GitLab config missing");

      return new GitLabStorage(
        {
          project: config.gitlab.project,
          branch: config.gitlab.branch,
          instanceUrl: config.gitlab.instanceUrl,
          publishMode: config.gitlab.publishMode,
        },
        collections,
        mediaDirectory,
      );
    }

    default:
      return new LocalStorage(collections, mediaDirectory);
  }
}

/**
 * The one place both backends are constructed, because a repository media
 * library *is* the storage backend — and so is the working tree a dev run puts
 * in front of an object store (`localMediaInDev`), which differs from the store
 * only in where the bytes are. The storage backend is then told which library
 * entry validation checks against.
 */
function wire(): { storage: StorageBase; media: MediaBackend } {
  if (wired) return wired;

  const storage = createStorage();
  const backend = config.mediaBackend;
  const media =
    backend.type === "remote" && !backend.local ? new RemoteMedia(backend.publicUrl) : storage;

  storage.useMediaSource(media);
  wired = { storage, media };

  return wired;
}

export const getStorage = (): StorageBackend => wire().storage;

export const getMedia = (): MediaBackend => wire().media;

export type { StorageBackend };
