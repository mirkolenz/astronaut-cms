import { Octokit } from "@octokit/rest";
import type {
  ChangeKind,
  CollectionManifest,
  EntryMeta,
  FileChange,
  MediaFile,
  SaveEntryRequest,
} from "@shared/types";
import { serializeContent } from "@shared/content-parser";
import { BranchedStorage } from "./base";
import type { ChangeRequestSummary, PublishMode } from "./types";
import { MergeConflictError, getErrorStatus } from "./types";
import { getToken, fileToBase64 } from "./utils";

interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  publishMode: PublishMode;
}

type TreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
};

// GitHub reports "copied" and "changed" alongside the familiar statuses; both
// read as an ordinary modification to a content editor.
const FILE_STATUS: Record<string, ChangeKind> = {
  added: "added",
  removed: "deleted",
  modified: "modified",
  renamed: "renamed",
  copied: "added",
  changed: "modified",
  unchanged: "modified",
};

/** One blob of the repository tree, reduced to what a listing needs. */
interface TreeFile {
  path: string;
  size: number;
}

export class GitHubStorage extends BranchedStorage {
  private config: GitHubConfig;
  private cachedOctokit: Octokit | null = null;
  private cachedOctokitToken: string | null = null;
  private treeCache: { ref: string; entries: Promise<TreeFile[]> } | null = null;

  constructor(config: GitHubConfig, schemas: CollectionManifest, mediaDirectory: string) {
    super(schemas, mediaDirectory, config.publishMode);
    this.config = config;
  }

  private get octokit(): Octokit {
    const token = getToken();
    if (!this.cachedOctokit || this.cachedOctokitToken !== token) {
      this.cachedOctokit = new Octokit({ auth: token });
      this.cachedOctokitToken = token;
    }
    return this.cachedOctokit;
  }

  protected get defaultBranch(): string {
    return this.config.branch;
  }

  protected async fetchUsername(): Promise<string> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return data.login;
  }

  protected async checkBranchExists(branch: string): Promise<boolean> {
    try {
      await this.octokit.rest.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${branch}`,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The recursive tree of the current ref. It is the whole repository listing,
   * and every collection and the media library are filtered out of the same one,
   * so it is fetched once per ref rather than once per caller.
   */
  private async tree(): Promise<TreeFile[]> {
    const ref = await this.readRef();

    if (this.treeCache?.ref === ref) return this.treeCache.entries;

    const cache = {
      ref,
      entries: this.octokit.rest.git
        .getTree({
          owner: this.config.owner,
          repo: this.config.repo,
          tree_sha: ref,
          recursive: "1",
        })
        .then(({ data }) =>
          data.tree
            .filter((item) => item.type === "blob" && !!item.path)
            .map((item) => ({ path: item.path!, size: item.size ?? 0 })),
        )
        .catch((): TreeFile[] => {
          // A failed listing must not become what every later call reads: the
          // cache is dropped so the next caller retries instead of seeing an
          // empty repository until the next commit.
          if (this.treeCache === cache) this.treeCache = null;

          return [];
        }),
    };

    this.treeCache = cache;

    return cache.entries;
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (!this.schemas[collection]) return [];
    if (this.isFileCollection(collection)) return this.listFileCollectionEntries(collection);

    return this.entriesFromTreePaths(
      collection,
      (await this.tree()).map((item) => item.path),
    );
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    return this.fetchFileContent(this.getEntryPath(collection, id, ext));
  }

  /**
   * The contents API narrowed to the one file it was asked for. `mediaType`
   * selects the representation: the default JSON form carries the base64 body
   * and stops at 1 MB, `object` reaches 100 MB and is what a `download_url` needs.
   */
  private async getRepoFile(path: string, format?: "object") {
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      path,
      ref: await this.readRef(),
      ...(format && { mediaType: { format } }),
    });

    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`Expected file at ${path}`);
    }

    return data;
  }

  protected async fetchFileContent(path: string): Promise<string> {
    const { content } = await this.getRepoFile(path);

    return atob(content.replace(/\n/g, ""));
  }

  async listMedia(): Promise<MediaFile[]> {
    return this.mediaFiles(await this.tree());
  }

  protected async writeEntry(
    collection: string,
    id: string,
    data: SaveEntryRequest,
  ): Promise<void> {
    const message = `Update ${collection}/${id}`;
    let path: string;
    let content: string;
    if (this.isFileCollection(collection)) {
      ({ path, content } = await this.upsertFileCollectionEntry(collection, id, data.data));
    } else {
      path = this.getEntryPath(collection, id, data.format);
      content = serializeContent(data.data, data.body, data.format);
    }
    await this.commitBlobs([{ path, content, encoding: "utf-8" }], message);
  }

  async deleteEntry(collection: string, id: string): Promise<void> {
    const message = `Delete ${collection}/${id}`;
    if (this.isFileCollection(collection)) {
      const { path, content } = await this.removeFileCollectionEntry(collection, id);
      await this.commitBlobs([{ path, content, encoding: "utf-8" }], message);
      return;
    }
    const entry = await this.getEntry(collection, id);
    const path = this.getEntryPath(collection, id, entry.format);
    await this.commitTree([{ path, mode: "100644", type: "blob", sha: null }], message);
  }

  protected async writeMedia(repoPath: string, file: File): Promise<void> {
    const content = await fileToBase64(file);

    await this.commitBlobs([{ path: repoPath, content, encoding: "base64" }], `Upload ${repoPath}`);
  }

  /**
   * A repository file has no public URL. The contents API answers with a
   * `download_url` carrying its own short-lived token for a private repository,
   * which is the one form an `<img>` can load without sending headers.
   */
  async readUrl(path: string): Promise<string> {
    const { download_url } = await this.getRepoFile(this.mediaRepoPath(path), "object");

    if (!download_url) throw new Error(`No download URL for ${path}`);

    return download_url;
  }

  protected async moveMedia(from: string, to: string): Promise<void> {
    const { sha } = await this.getRepoFile(from);

    await this.commitTree(
      [
        { path: to, mode: "100644", type: "blob", sha },
        { path: from, mode: "100644", type: "blob", sha: null },
      ],
      `Rename ${from} to ${to}`,
    );
  }

  protected async removeMedia(repoPath: string): Promise<void> {
    await this.commitTree(
      [{ path: repoPath, mode: "100644", type: "blob", sha: null }],
      `Delete ${repoPath}`,
    );
  }

  async reorderEntries(collection: string, ids: string[]): Promise<void> {
    if (!this.isFileCollection(collection)) {
      throw new Error(`Reorder is only supported for file collections (got "${collection}")`);
    }
    const { path, content } = await this.buildReorderedFileCollection(collection, ids);
    await this.commitBlobs([{ path, content, encoding: "utf-8" }], `Reorder ${collection}`);
  }

  protected async doUpdate(branch: string): Promise<void> {
    // Merging rewrites the branch this reads from, so the cached listing goes too.
    this.treeCache = null;

    try {
      await this.octokit.rest.repos.merge({
        owner: this.config.owner,
        repo: this.config.repo,
        base: branch,
        head: this.config.branch,
        commit_message: `Merge ${this.config.branch} into ${branch}`,
      });
    } catch (err) {
      const status = getErrorStatus(err);
      if (status === 405 || status === 409) throw new MergeConflictError();
      throw err;
    }
  }

  private async compare(branch: string) {
    const { data } = await this.octokit.rest.repos.compareCommitsWithBasehead({
      owner: this.config.owner,
      repo: this.config.repo,
      basehead: `${this.config.branch}...${branch}`,
    });
    return data;
  }

  protected async computeBehind(branch: string): Promise<number> {
    return (await this.compare(branch)).behind_by;
  }

  protected async diffAgainstDefault(branch: string): Promise<FileChange[]> {
    const cmp = await this.compare(branch);
    return (cmp.files ?? []).map((file) => ({
      path: file.filename,
      kind: FILE_STATUS[file.status] ?? "modified",
      previousPath: file.previous_filename,
      patch: file.patch,
    }));
  }

  protected async findOpenChangeRequest(branch: string): Promise<ChangeRequestSummary | null> {
    const { data } = await this.octokit.rest.pulls.list({
      owner: this.config.owner,
      repo: this.config.repo,
      state: "open",
      head: `${this.config.owner}:${branch}`,
    });
    const first = data[0];
    if (!first) return null;
    return { id: first.number, title: first.title, url: first.html_url };
  }

  protected async createChangeRequest(branch: string): Promise<ChangeRequestSummary> {
    const { data } = await this.octokit.rest.pulls.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title: this.changeRequestTitle(branch),
      head: branch,
      base: this.config.branch,
      body: this.changeRequestBody(branch),
    });
    return { id: data.number, title: data.title, url: data.html_url };
  }

  protected async closeChangeRequest(id: number): Promise<void> {
    await this.octokit.rest.pulls.update({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: id,
      state: "closed",
    });
  }

  protected async acceptChangeRequest(request: ChangeRequestSummary): Promise<void> {
    await this.octokit.rest.pulls.merge({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: request.id,
      merge_method: "squash",
      commit_title: `${request.title} (#${request.id})`,
    });
  }

  protected async deleteUserBranch(branch: string): Promise<void> {
    await this.octokit.rest.git.deleteRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${branch}`,
    });
  }

  private async commitBlobs(
    blobs: Array<{ path: string; content: string; encoding: "utf-8" | "base64" }>,
    message: string,
  ): Promise<void> {
    const api = this.octokit;
    const branch = await this.getUserBranch();
    const exists = await this.branchExists(branch);
    const parentBranch = exists ? branch : this.config.branch;

    const [blobResults, { data: parentRef }] = await Promise.all([
      Promise.all(
        blobs.map((b) =>
          api.rest.git.createBlob({
            owner: this.config.owner,
            repo: this.config.repo,
            content: b.content,
            encoding: b.encoding,
          }),
        ),
      ),
      api.rest.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${parentBranch}`,
      }),
    ]);

    const treeEntries: TreeEntry[] = blobs.map((b, i) => ({
      path: b.path,
      mode: "100644",
      type: "blob",
      sha: blobResults[i].data.sha,
    }));

    await this.finalizeCommit(branch, exists, parentRef.object.sha, treeEntries, message);
  }

  private async commitTree(treeEntries: TreeEntry[], message: string): Promise<void> {
    const branch = await this.getUserBranch();
    const exists = await this.branchExists(branch);
    const parentBranch = exists ? branch : this.config.branch;
    const { data: parentRef } = await this.octokit.rest.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${parentBranch}`,
    });
    await this.finalizeCommit(branch, exists, parentRef.object.sha, treeEntries, message);
  }

  /** The commit funnel, and therefore where the cached tree stops being current. */
  private async finalizeCommit(
    branch: string,
    exists: boolean,
    parentSha: string,
    treeEntries: TreeEntry[],
    message: string,
  ): Promise<void> {
    const api = this.octokit;
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

    if (exists) {
      await api.rest.git.updateRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${branch}`,
        sha: commit.sha,
      });
    } else {
      await api.rest.git.createRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
      this.markBranchExists(true);
    }

    this.treeCache = null;
  }
}
