import type { CollectionInfo, EntryMeta, MediaFile } from "@/shared/types";
import { ALL_FORMATS } from "@/shared/types";
import { RemoteStorageBase } from "./remote-base";
import { getToken, getFormat, stripExtension, fileToBase64, stripMediaPrefix } from "./utils";
import type { PendingChange } from "@/client/stores/changes-store";

interface GitHubConfig {
  repo: string;
  branch: string;
}

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface GitHubFileContent {
  content: string;
  encoding: string;
  sha: string;
  size: number;
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
}

async function githubFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export class GitHubStorage extends RemoteStorageBase {
  private config: GitHubConfig;

  constructor(
    config: GitHubConfig,
    schemas: Record<string, CollectionInfo>,
    mediaDirectory: string,
  ) {
    super(schemas, mediaDirectory);
    this.config = config;
  }

  private get apiBase(): string {
    return `https://api.github.com/repos/${this.config.repo}`;
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (!this.schemas[collection]) return [];

    const prefix = `src/content/${collection}/`;
    try {
      const { tree } = await githubFetch<{ tree: GitHubTreeItem[] }>(
        `${this.apiBase}/git/trees/${this.config.branch}?recursive=1`,
      );
      return tree
        .filter((item) => {
          if (item.type !== "blob") return false;
          if (!item.path.startsWith(prefix)) return false;
          const ext = getFormat(item.path);
          return (ALL_FORMATS as readonly string[]).includes(ext);
        })
        .map((item) => {
          const relativePath = item.path.slice(prefix.length);
          return {
            id: stripExtension(relativePath),
            collection,
            format: getFormat(item.path),
          };
        });
    } catch {
      return [];
    }
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    const path = this.getEntryPath(collection, id, ext);
    const file = await githubFetch<GitHubFileContent>(
      `${this.apiBase}/contents/${path}?ref=${this.config.branch}`,
    );
    return atob(file.content.replace(/\n/g, ""));
  }

  async listMedia(): Promise<MediaFile[]> {
    const prefix = `${this.mediaDirectory}/`;
    try {
      const { tree } = await githubFetch<{ tree: GitHubTreeItem[] }>(
        `${this.apiBase}/git/trees/${this.config.branch}?recursive=1`,
      );
      return tree
        .filter((item) => item.type === "blob" && item.path.startsWith(prefix))
        .map((item) => ({
          path: item.path,
          size: item.size ?? 0,
          lastModified: "",
        }));
    } catch {
      return [];
    }
  }

  async uploadMedia(path: string, file: File): Promise<MediaFile> {
    const repoPath = `${this.mediaDirectory}/${path}`;
    const content = await fileToBase64(file);

    const blob = await githubFetch<{ sha: string }>(`${this.apiBase}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, encoding: "base64" }),
    });

    await this.createCommit(
      [{ path: repoPath, mode: "100644", type: "blob", sha: blob.sha }],
      `Upload ${repoPath}`,
    );

    return { path: repoPath, size: file.size, lastModified: "" };
  }

  async replaceMedia(path: string, file: File): Promise<MediaFile> {
    return this.uploadMedia(stripMediaPrefix(path, this.mediaDirectory), file);
  }

  async renameMedia(oldPath: string, newPath: string): Promise<MediaFile> {
    const oldFile = await githubFetch<GitHubFileContent>(
      `${this.apiBase}/contents/${oldPath}?ref=${this.config.branch}`,
    );

    await this.createCommit(
      [
        { path: newPath, mode: "100644", type: "blob", sha: oldFile.sha },
        { path: oldPath, mode: "100644", type: "blob", sha: null },
      ],
      `Rename ${oldPath} to ${newPath}`,
    );

    return { path: newPath, size: oldFile.size, lastModified: "" };
  }

  async deleteMedia(path: string): Promise<void> {
    await this.createCommit([{ path, mode: "100644", type: "blob", sha: null }], `Delete ${path}`);
  }

  protected async doPublish(changes: PendingChange[]): Promise<void> {
    const treeEntries: TreeEntry[] = [];
    const processedMessages: string[] = [];

    for (const change of changes) {
      if (!this.schemas[change.collection]) continue;
      const path = this.getEntryPath(change.collection, change.entryId, change.format);

      if (change.action === "delete") {
        treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
        processedMessages.push(change.message);
      } else if (change.content) {
        const blob = await githubFetch<{ sha: string }>(`${this.apiBase}/git/blobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: change.content, encoding: "utf-8" }),
        });
        treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
        processedMessages.push(change.message);
      }
    }

    if (treeEntries.length === 0) return;

    await this.createCommit(treeEntries, this.buildCommitMessage(processedMessages));
  }

  private async createCommit(treeEntries: TreeEntry[], message: string): Promise<string> {
    const ref = await githubFetch<{ object: { sha: string } }>(
      `${this.apiBase}/git/ref/heads/${this.config.branch}`,
    );
    const parentSha = ref.object.sha;

    const parentCommit = await githubFetch<{ tree: { sha: string } }>(
      `${this.apiBase}/git/commits/${parentSha}`,
    );

    const tree = await githubFetch<{ sha: string }>(`${this.apiBase}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: treeEntries }),
    });

    const commit = await githubFetch<{ sha: string }>(`${this.apiBase}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
    });

    await githubFetch(`${this.apiBase}/git/refs/heads/${this.config.branch}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commit.sha }),
    });

    return commit.sha;
  }
}
