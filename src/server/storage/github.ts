import type { ChangeKind, EntryMeta, FileChange, MediaFile } from "../../shared/types.ts";
import { BranchedStorage, fromBase64, type StorageOptions } from "./base.ts";
import type {
  ChangeRequestSummary,
  MediaContent,
  Precondition,
  PublishMode,
  VersionedContent,
} from "./types.ts";
import {
  MergeConflictError,
  exists,
  getErrorStatus,
  satisfies,
  staleWrite,
  versioned,
} from "./types.ts";
import { ApiClient } from "./api.ts";
import { encodeKeyPath } from "../../shared/media.ts";

export const GITHUB_API = "https://api.github.com";

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  publishMode: PublishMode;
}

/** The GitHub API as the CMS addresses it, with the caller's token attached. */
export function githubClient(token: string): ApiClient {
  return new ApiClient(GITHUB_API, {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    // Required by the API; browsers override it with their own, which is also accepted.
    "user-agent": "astronaut-cms",
  });
}

/** One entry of a commit's tree. A null `sha` deletes the path. */
interface TreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
}

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
  /** The blob hash, which names the contents and so can address them. */
  version: string;
}

interface RepoFile {
  type: string;
  sha: string;
  content?: string;
  encoding?: string;
  download_url?: string | null;
}

interface PullRequest {
  number: number;
  title: string;
  html_url: string;
}

export class GitHubStorage extends BranchedStorage {
  private readonly config: GitHubConfig;
  private readonly api: ApiClient;
  private treeCache: { ref: string; entries: Promise<TreeFile[]> } | null = null;

  constructor(config: GitHubConfig, options: StorageOptions, token: string) {
    super(options, config.publishMode);
    this.config = config;
    this.api = githubClient(token);
  }

  /** The `repos/owner/repo` prefix every call repeats. */
  private get repo(): string {
    return `repos/${this.config.owner}/${this.config.repo}`;
  }

  protected get defaultBranch(): string {
    return this.config.branch;
  }

  protected async checkBranchExists(branch: string): Promise<boolean> {
    return exists(this.api.send({ path: `${this.repo}/git/ref/heads/${branch}` }));
  }

  /**
   * The recursive tree of the current ref. It is the whole repository listing,
   * and every collection and the media library are filtered out of the same one,
   * so it is fetched once per request rather than once per caller.
   */
  private async tree(): Promise<TreeFile[]> {
    const ref = await this.readRef();

    if (this.treeCache?.ref === ref) return this.treeCache.entries;

    const cache = {
      ref,
      entries: this.api
        .json<{
          tree: Array<{ type: string; path: string; size?: number; sha: string }>;
          truncated?: boolean;
        }>({
          path: `${this.repo}/git/trees/${ref}`,
          query: { recursive: "1" },
        })
        .then(({ tree, truncated }) => {
          if (truncated) throw new Error("GitHub returned an incomplete repository tree.");

          return tree
            .filter((item) => item.type === "blob")
            .map((item) => ({ path: item.path, size: item.size ?? 0, version: item.sha }));
        })
        .catch((error: unknown): never => {
          // A failed listing must not become what every later call reads: the
          // cache is dropped so the next caller retries instead of seeing an
          // empty repository.
          if (this.treeCache === cache) this.treeCache = null;

          throw error;
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

  /**
   * The contents API narrowed to the one file it was asked for. The `object`
   * media type is what raises the 1 MB ceiling to 100 MB and guarantees an
   * object rather than a directory array, so it is what a `download_url` needs.
   */
  private async getRepoFile(path: string, asObject = false, ref?: string): Promise<RepoFile> {
    const file = await this.api.json<RepoFile>({
      path: `${this.repo}/contents/${encodeKeyPath(path)}`,
      query: { ref: ref ?? (await this.readRef()) },
      ...(asObject && { accept: "application/vnd.github.object+json" }),
    });

    if (file.type !== "file") throw new Error(`Expected file at ${path}`);

    return file;
  }

  protected override async fetchFileContent(path: string): Promise<VersionedContent> {
    const file = await this.getRepoFile(path);

    if (file.encoding === "base64") {
      return { content: fromBase64(file.content ?? ""), version: file.sha };
    }

    const blob = await this.api.json<{ content: string; encoding: string }>({
      path: `${this.repo}/git/blobs/${file.sha}`,
    });

    if (blob.encoding !== "base64") throw new Error(`Unsupported encoding for ${path}`);

    return { content: fromBase64(blob.content), version: file.sha };
  }

  /**
   * The blob hash at `path` on one commit, or undefined when it holds no such
   * file. Read against the commit the write will be based on rather than against
   * the branch, so what is checked and what is committed cannot be two different
   * states.
   */
  private async blobShaAt(path: string, ref: string): Promise<string | undefined> {
    try {
      return (await this.getRepoFile(path, false, ref)).sha;
    } catch (err) {
      if (getErrorStatus(err) === 404) return undefined;

      throw err;
    }
  }

  async listMedia(): Promise<MediaFile[]> {
    return this.mediaFiles(await this.tree());
  }

  protected async commitFile(
    path: string,
    content: string,
    message: string,
    precondition?: Precondition,
  ): Promise<string | undefined> {
    return this.commitBlob(path, content, "utf-8", message, precondition);
  }

  protected async removeFile(
    path: string,
    message: string,
    expectedVersion?: string,
  ): Promise<void> {
    await this.commitTree(
      [{ path, mode: "100644", type: "blob", sha: null }],
      message,
      undefined,
      preconditionsFor(path, versioned(expectedVersion)),
    );
  }

  protected async writeMedia(
    repoPath: string,
    bytes: Uint8Array<ArrayBuffer>,
    overwrite: boolean,
  ): Promise<void> {
    await this.commitBlob(
      repoPath,
      bytes.toBase64(),
      "base64",
      `Upload ${repoPath}`,
      overwrite ? undefined : { absent: true },
    );
  }

  /**
   * A repository file has no public URL. The contents API answers with a
   * `download_url` carrying its own short-lived token for a private repository,
   * so the browser loads the bytes itself rather than through this server —
   * except when the caller addressed a version, which a redirect cannot promise
   * to keep and which the route therefore serves itself. The blob hash comes
   * back from the same call, so naming it costs nothing.
   */
  async readMedia(path: string): Promise<MediaContent> {
    const { download_url, sha } = await this.getRepoFile(this.mediaRepoPath(path), true);

    if (!download_url) throw new Error(`No download URL for ${path}`);

    return { redirect: download_url, version: sha };
  }

  protected async moveMedia(from: string, to: string): Promise<void> {
    const { sha } = await this.getRepoFile(from);

    await this.commitTree(
      [
        { path: to, mode: "100644", type: "blob", sha },
        { path: from, mode: "100644", type: "blob", sha: null },
      ],
      `Rename ${from} to ${to}`,
      undefined,
      [
        { path: from, precondition: { version: sha } },
        { path: to, precondition: { absent: true } },
      ],
    );
  }

  protected async removeMedia(repoPath: string): Promise<void> {
    await this.removeFile(repoPath, `Delete ${repoPath}`);
  }

  protected async doUpdate(branch: string): Promise<void> {
    // Merging rewrites the branch this reads from, so the cached listing goes too.
    this.treeCache = null;

    try {
      await this.api.run({
        path: `${this.repo}/merges`,
        method: "POST",
        body: {
          base: branch,
          head: this.config.branch,
          commit_message: `Merge ${this.config.branch} into ${branch}`,
        },
      });
    } catch (err) {
      const status = getErrorStatus(err);

      if (status === 405 || status === 409) throw new MergeConflictError();

      throw err;
    }
  }

  private async compare(branch: string) {
    return this.api.json<{
      behind_by: number;
      files?: Array<{
        filename: string;
        status: string;
        previous_filename?: string;
        patch?: string;
        sha: string;
      }>;
    }>({ path: `${this.repo}/compare/${this.config.branch}...${branch}` });
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
      version: file.sha,
    }));
  }

  protected async findOpenChangeRequest(branch: string): Promise<ChangeRequestSummary | null> {
    const [first] = await this.api.json<PullRequest[]>({
      path: `${this.repo}/pulls`,
      query: { state: "open", head: `${this.config.owner}:${branch}` },
    });

    return first ? summarize(first) : null;
  }

  protected async createChangeRequest(branch: string): Promise<ChangeRequestSummary> {
    return summarize(
      await this.api.json<PullRequest>({
        path: `${this.repo}/pulls`,
        method: "POST",
        body: {
          title: this.changeRequestTitle(branch),
          head: branch,
          base: this.config.branch,
          body: this.changeRequestBody(branch),
        },
      }),
    );
  }

  protected async closeChangeRequest(id: number): Promise<void> {
    await this.api.run({
      path: `${this.repo}/pulls/${id}`,
      method: "PATCH",
      body: { state: "closed" },
    });
  }

  protected async acceptChangeRequest(request: ChangeRequestSummary): Promise<void> {
    await this.api.run({
      path: `${this.repo}/pulls/${request.id}/merge`,
      method: "PUT",
      body: { merge_method: "squash", commit_title: `${request.title} (#${request.id})` },
    });
  }

  protected async deleteUserBranch(branch: string): Promise<void> {
    await this.api.run({ path: `${this.repo}/git/refs/heads/${branch}`, method: "DELETE" });
  }

  /**
   * A file's new content, uploaded as a blob and committed in one tree entry.
   * The upload and the parent lookup are independent, so they overlap: this is
   * the path every content save and every repository media upload takes.
   */
  private async commitBlob(
    path: string,
    content: string,
    encoding: "utf-8" | "base64",
    message: string,
    precondition?: Precondition,
  ): Promise<string> {
    const [blob, parentSha] = await Promise.all([
      this.api.json<{ sha: string }>({
        path: `${this.repo}/git/blobs`,
        method: "POST",
        body: { content, encoding },
      }),
      this.parentSha(),
    ]);

    await this.commitTree(
      [{ path, mode: "100644", type: "blob", sha: blob.sha }],
      message,
      parentSha,
      preconditionsFor(path, precondition),
    );

    // The blob that was just committed, which is exactly what a read of this
    // path would now report as its version.
    return blob.sha;
  }

  /** The commit the next one builds on: the draft branch's tip, or the default branch's. */
  private async parentSha(): Promise<string> {
    const branchExists = await this.branchExists();
    const parent = await this.api.json<{ object: { sha: string } }>({
      path: `${this.repo}/git/ref/heads/${branchExists ? this.branch : this.config.branch}`,
    });

    return parent.object.sha;
  }

  /** The commit funnel, and therefore where the cached tree stops being current. */
  private async commitTree(
    treeEntries: TreeEntry[],
    message: string,
    knownParent?: string,
    preconditions: Array<{ path: string; precondition: Precondition }> = [],
  ): Promise<void> {
    const parentSha = knownParent ?? (await this.parentSha());

    // The precondition is checked against the very commit this one will name as
    // its parent, and the ref below is advanced without `force` — so a branch
    // that moved in between makes the update a non-fast-forward and the write
    // fails rather than landing on top of whatever arrived. It depends on
    // nothing the parent commit does, so the two are read together.
    const [checked, parentCommit] = await Promise.all([
      Promise.all(
        preconditions.map(async (required) => ({
          ...required,
          actual: await this.blobShaAt(required.path, parentSha),
        })),
      ),
      this.api.json<{ tree: { sha: string } }>({ path: `${this.repo}/git/commits/${parentSha}` }),
    ]);
    const failed = checked.find(({ actual, precondition }) => !satisfies(actual, precondition));

    if (failed) throw staleWrite(failed.path);

    const tree = await this.api.json<{ sha: string }>({
      path: `${this.repo}/git/trees`,
      method: "POST",
      body: { base_tree: parentCommit.tree.sha, tree: treeEntries },
    });
    const commit = await this.api.json<{ sha: string }>({
      path: `${this.repo}/git/commits`,
      method: "POST",
      body: { message, tree: tree.sha, parents: [parentSha] },
    });

    if (await this.branchExists()) {
      await this.api.run({
        path: `${this.repo}/git/refs/heads/${this.branch}`,
        method: "PATCH",
        body: { sha: commit.sha },
      });
    } else {
      await this.api.run({
        path: `${this.repo}/git/refs`,
        method: "POST",
        body: { ref: `refs/heads/${this.branch}`, sha: commit.sha },
      });
      this.markBranchExists(true);
    }

    this.treeCache = null;
  }
}

/** One path's precondition in the shape `commitTree` checks, or nothing to check. */
const preconditionsFor = (path: string, precondition?: Precondition) =>
  precondition === undefined ? [] : [{ path, precondition }];

const summarize = (pull: PullRequest): ChangeRequestSummary => ({
  id: pull.number,
  title: pull.title,
  url: pull.html_url,
});
