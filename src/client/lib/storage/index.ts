import config from "virtual:astronaut-cms/config";
import type { StorageBackend } from "./types";
import type { CollectionInfo } from "@/shared/types";
import { LocalStorage } from "./local";
import { GitHubStorage } from "./github";
import { GitLabStorage } from "./gitlab";

let instance: StorageBackend | null = null;

export function initializeStorage(schemas: Record<string, CollectionInfo>): StorageBackend {
  if (instance) return instance;

  const mediaDirectory = config.mediaDirectory ?? "src/assets";

  switch (config.storageType) {
    case "github": {
      if (!config.github) throw new Error("GitHub config missing");
      const [owner, repo] = config.github.repo.split("/");
      instance = new GitHubStorage(
        { owner, repo, branch: config.github.branch ?? "main" },
        schemas,
        mediaDirectory,
      );
      return instance;
    }
    case "gitlab": {
      if (!config.gitlab) throw new Error("GitLab config missing");
      instance = new GitLabStorage(
        {
          project: config.gitlab.project,
          branch: config.gitlab.branch ?? "main",
          instanceUrl: config.gitlab.instanceUrl ?? "https://gitlab.com",
        },
        schemas,
        mediaDirectory,
      );
      return instance;
    }
    default:
      instance = new LocalStorage(mediaDirectory);
      return instance;
  }
}

export function getStorage(): StorageBackend {
  if (!instance) {
    if (config.storageType === "local") {
      const mediaDirectory = config.mediaDirectory ?? "src/assets";
      instance = new LocalStorage(mediaDirectory);
      return instance;
    }
    throw new Error("Storage not initialized. Call initializeStorage(schemas) first.");
  }
  return instance;
}

export function resetStorage(): void {
  instance = null;
}

export type { StorageBackend };
