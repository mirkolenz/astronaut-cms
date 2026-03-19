import { Octokit } from "@octokit/rest";
import type { CollectionInfo, EntryMeta, MediaFile } from "@/shared/types";
import { ALL_FORMATS } from "@/shared/types";
import { StorageBase } from "./base";
import { getToken, getFormat, stripExtension, fileToBase64, stripMediaPrefix } from "./utils";
import type { PendingChange } from "@/client/stores/changes-store";

interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
}

export class GitHubStorage extends StorageBase {
  private config: GitHubConfig;

  constructor(
    config: GitHubConfig,
    schemas: Record<string, CollectionInfo>,
    mediaDirectory: string,
  ) {
    super(schemas, mediaDirectory);
    this.config = config;
  }

  private get octokit() {
    return new Octokit({ auth: getToken() });
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (!this.schemas[collection]) return [];

    if (this.isFileCollection(collection)) {
      return this.listFileCollectionEntries(collection);
    }

    const prefix = `src/content/${collection}/`;
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner: this.config.owner,
        repo: this.config.repo,
        tree_sha: this.config.branch,
        recursive: "1",
      });
      return data.tree
        .filter((item) => {
          if (item.type !== "blob") return false;
          if (!item.path?.startsWith(prefix)) return false;
          const ext = getFormat(item.path);
          return (ALL_FORMATS as readonly string[]).includes(ext);
        })
        .map((item) => {
          const relativePath = item.path!.slice(prefix.length);
          return {
            id: stripExtension(relativePath),
            collection,
            format: getFormat(item.path!),
          };
        });
    } catch {
      return [];
    }
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    const path = this.getEntryPath(collection, id, ext);
    return this.fetchFileContent(path);
  }

  protected async fetchFileContent(path: string): Promise<string> {
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      path,
      ref: this.config.branch,
    });
    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`Expected file at ${path}`);
    }
    return atob(data.content.replace(/\n/g, ""));
  }

  async listMedia(): Promise<MediaFile[]> {
    const prefix = `${this.mediaDirectory}/`;
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner: this.config.owner,
        repo: this.config.repo,
        tree_sha: this.config.branch,
        recursive: "1",
      });
      return data.tree
        .filter((item) => item.type === "blob" && item.path?.startsWith(prefix))
        .map((item) => ({
          path: item.path!,
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

    const { data: blob } = await this.octokit.rest.git.createBlob({
      owner: this.config.owner,
      repo: this.config.repo,
      content,
      encoding: "base64",
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
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      path: oldPath,
      ref: this.config.branch,
    });
    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`Expected file at ${oldPath}`);
    }

    await this.createCommit(
      [
        { path: newPath, mode: "100644", type: "blob", sha: data.sha },
        { path: oldPath, mode: "100644", type: "blob", sha: null },
      ],
      `Rename ${oldPath} to ${newPath}`,
    );

    return { path: newPath, size: data.size, lastModified: "" };
  }

  async deleteMedia(path: string): Promise<void> {
    await this.createCommit([{ path, mode: "100644", type: "blob", sha: null }], `Delete ${path}`);
  }

  protected async doPublish(changes: PendingChange[]): Promise<void> {
    const treeEntries: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      sha: string | null;
    }> = [];
    const processedMessages: string[] = [];

    const { globChanges, fileCollections } = this.groupChangesForPublish(changes);

    // Glob collection changes: one tree entry per file
    for (const change of globChanges) {
      const path = this.getEntryPath(change.collection, change.entryId, change.format);

      if (change.action === "delete") {
        treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
        processedMessages.push(change.message);
      } else if (change.content) {
        const { data: blob } = await this.octokit.rest.git.createBlob({
          owner: this.config.owner,
          repo: this.config.repo,
          content: change.content,
          encoding: "utf-8",
        });
        treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
        processedMessages.push(change.message);
      }
    }

    // File collection changes: merge into single file per collection
    for (const [collection, colChanges] of Object.entries(fileCollections)) {
      const result = await this.mergeFileCollectionChanges(collection, colChanges);
      const { data: blob } = await this.octokit.rest.git.createBlob({
        owner: this.config.owner,
        repo: this.config.repo,
        content: result.content,
        encoding: "utf-8",
      });
      treeEntries.push({ path: result.path, mode: "100644", type: "blob", sha: blob.sha });
      processedMessages.push(...result.messages);
    }

    if (treeEntries.length === 0) return;

    await this.createCommit(treeEntries, this.buildCommitMessage(processedMessages));
  }

  private async createCommit(
    treeEntries: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      sha: string | null;
    }>,
    message: string,
  ): Promise<string> {
    const api = this.octokit;

    const { data: ref } = await api.rest.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${this.config.branch}`,
    });
    const parentSha = ref.object.sha;

    const { data: parentCommit } = await api.rest.git.getCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      commit_sha: parentSha,
    });

    const { data: tree } = await api.rest.git.createTree({
      owner: this.config.owner,
      repo: this.config.repo,
      base_tree: parentCommit.tree.sha,
      tree: treeEntries,
    });

    const { data: commit } = await api.rest.git.createCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      message,
      tree: tree.sha,
      parents: [parentSha],
    });

    await api.rest.git.updateRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${this.config.branch}`,
      sha: commit.sha,
    });

    return commit.sha;
  }
}
