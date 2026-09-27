import config from "virtual:astronaut-cms/config";
import collections from "virtual:astronaut-cms/collections";
import type { StorageBackend } from "./types";
import { LocalStorage } from "./local";
import { GitHubStorage } from "./github";
import { GitLabStorage } from "./gitlab";
import { parseRepo } from "@client/lib/oauth/github";

let instance: StorageBackend | null = null;

function createStorage(): StorageBackend {
  const mediaDirectory = config.mediaDirectory ?? "src/assets";

  switch (config.storageType) {
    case "github": {
      if (!config.github) throw new Error("GitHub config missing");

      const { owner, repo } = parseRepo(config.github.repo);

      return new GitHubStorage(
        {
          owner,
          repo,
          branch: config.github.branch ?? "main",
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
          branch: config.gitlab.branch ?? "main",
          instanceUrl: config.gitlab.instanceUrl ?? "https://gitlab.com",
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

export function getStorage(): StorageBackend {
  instance ??= createStorage();

  return instance;
}

export type { StorageBackend };
