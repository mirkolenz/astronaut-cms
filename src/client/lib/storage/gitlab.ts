import type { CollectionInfo, EntryMeta, MediaFile } from "@/shared/types";
import { ALL_FORMATS } from "@/shared/types";
import { RemoteStorageBase } from "./remote-base";
import { getToken, getFormat, stripExtension, fileToBase64 } from "./utils";
import type { PendingChange } from "@/client/stores/changes-store";

interface GitLabConfig {
  project: string;
  branch: string;
  instanceUrl: string;
}

interface GitLabTreeItem {
  name: string;
  path: string;
  type: "blob" | "tree";
}

async function gitlabFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitLab API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function gitlabFetchText(url: string, init?: RequestInit): Promise<string> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitLab API ${res.status}: ${body}`);
  }
  return res.text();
}

export class GitLabStorage extends RemoteStorageBase {
  private config: GitLabConfig;

  constructor(
    config: GitLabConfig,
    schemas: Record<string, CollectionInfo>,
    mediaDirectory: string,
  ) {
    super(schemas, mediaDirectory);
    this.config = config;
  }

  private get apiBase(): string {
    return `${this.config.instanceUrl}/api/v4/projects/${encodeURIComponent(this.config.project)}`;
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (!this.schemas[collection]) return [];

    const prefix = `src/content/${collection}/`;
    let items: GitLabTreeItem[];
    try {
      items = await gitlabFetch<GitLabTreeItem[]>(
        `${this.apiBase}/repository/tree?path=${encodeURIComponent(`src/content/${collection}`)}&ref=${this.config.branch}&recursive=true`,
      );
    } catch {
      return [];
    }

    return items
      .filter((item) => {
        if (item.type !== "blob") return false;
        const ext = getFormat(item.name);
        return (ALL_FORMATS as readonly string[]).includes(ext);
      })
      .map((item) => {
        const relativePath = item.path.slice(prefix.length);
        return {
          id: stripExtension(relativePath),
          collection,
          format: getFormat(item.name),
        };
      });
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    const filePath = this.getEntryPath(collection, id, ext);
    return gitlabFetchText(
      `${this.apiBase}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${this.config.branch}`,
    );
  }

  async listMedia(): Promise<MediaFile[]> {
    try {
      const items = await gitlabFetch<GitLabTreeItem[]>(
        `${this.apiBase}/repository/tree?path=${encodeURIComponent(this.mediaDirectory)}&ref=${this.config.branch}&recursive=true`,
      );
      return items
        .filter((item) => item.type === "blob")
        .map((item) => ({
          path: item.path,
          size: 0,
          lastModified: "",
        }));
    } catch {
      return [];
    }
  }

  async uploadMedia(path: string, file: File): Promise<MediaFile> {
    const repoPath = `${this.mediaDirectory}/${path}`;
    const content = await fileToBase64(file);

    await gitlabFetch(`${this.apiBase}/repository/commits`, {
      method: "POST",
      body: JSON.stringify({
        branch: this.config.branch,
        commit_message: `Upload ${repoPath}`,
        actions: [
          {
            action: "create",
            file_path: repoPath,
            content,
            encoding: "base64",
          },
        ],
      }),
    });

    return { path: repoPath, size: file.size, lastModified: "" };
  }

  async replaceMedia(path: string, file: File): Promise<MediaFile> {
    const content = await fileToBase64(file);

    await gitlabFetch(`${this.apiBase}/repository/commits`, {
      method: "POST",
      body: JSON.stringify({
        branch: this.config.branch,
        commit_message: `Replace ${path}`,
        actions: [
          {
            action: "update",
            file_path: path,
            content,
            encoding: "base64",
          },
        ],
      }),
    });

    return { path, size: file.size, lastModified: "" };
  }

  async renameMedia(oldPath: string, newPath: string): Promise<MediaFile> {
    await gitlabFetch(`${this.apiBase}/repository/commits`, {
      method: "POST",
      body: JSON.stringify({
        branch: this.config.branch,
        commit_message: `Rename ${oldPath} to ${newPath}`,
        actions: [
          {
            action: "move",
            file_path: newPath,
            previous_path: oldPath,
          },
        ],
      }),
    });

    return { path: newPath, size: 0, lastModified: "" };
  }

  async deleteMedia(path: string): Promise<void> {
    await gitlabFetch(`${this.apiBase}/repository/commits`, {
      method: "POST",
      body: JSON.stringify({
        branch: this.config.branch,
        commit_message: `Delete ${path}`,
        actions: [
          {
            action: "delete",
            file_path: path,
          },
        ],
      }),
    });
  }

  protected async doPublish(changes: PendingChange[]): Promise<void> {
    const actions = changes.map((change) => {
      const filePath = this.getEntryPath(change.collection, change.entryId, change.format);

      if (change.action === "delete") {
        return { action: "delete" as const, file_path: filePath };
      }

      return {
        action: change.action === "create" ? ("create" as const) : ("update" as const),
        file_path: filePath,
        content: change.content ?? "",
      };
    });

    const commitMessage = this.buildCommitMessage(changes.map((c) => c.message));

    await gitlabFetch(`${this.apiBase}/repository/commits`, {
      method: "POST",
      body: JSON.stringify({
        branch: this.config.branch,
        commit_message: commitMessage,
        actions,
      }),
    });
  }
}
