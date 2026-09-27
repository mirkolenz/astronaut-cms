import type { EntryMeta, FileChange, MediaFile } from "../../shared/types.ts";
import { BranchedStorage, toBase64, type StorageOptions } from "./base.ts";
import type { ChangeRequestSummary, MediaContent, PublishMode } from "./types.ts";
import { MergeConflictError, exists, getErrorStatus } from "./types.ts";
import { ApiClient } from "./api.ts";
import { joinUrl } from "../../shared/url.ts";

export interface GitLabConfig {
  project: string;
  branch: string;
  instanceUrl: string;
  publishMode: PublishMode;
}

/** The GitLab API of one instance, with the caller's token attached. */
export function gitlabClient(instanceUrl: string, token: string): ApiClient {
  return new ApiClient(joinUrl(instanceUrl, "api/v4"), {
    authorization: `Bearer ${token}`,
  });
}

/** One blob of a repository tree, reduced to what a listing needs. */
interface TreeFile {
  path: string;
  size?: number;
}

/** One action of a commit, in the shape GitLab's commits API takes. */
interface CommitAction {
  action: "create" | "update" | "delete" | "move";
  file_path: string;
  content?: string;
  encoding?: "text" | "base64";
  previous_path?: string;
}

interface MergeRequest {
  iid: number;
  title: string;
  web_url: string;
  merge_status?: string;
  merge_error?: string | null;
}

const summarize = (mr: MergeRequest): ChangeRequestSummary => ({
  id: mr.iid,
  title: mr.title,
  url: mr.web_url,
});

export class GitLabStorage extends BranchedStorage {
  private readonly config: GitLabConfig;
  private readonly api: ApiClient;

  /**
   * Listings already made this request, keyed by ref and path. Every collection
   * and the media library walk the tree separately, and the walk is paginated,
   * so a reference scan would otherwise re-page the same subtree once per
   * collection. GitHub's `treeCache` is the same idea over one whole-repository
   * listing; GitLab has no recursive-everything endpoint worth the payload.
   */
  private trees = new Map<string, Promise<TreeFile[]>>();

  constructor(config: GitLabConfig, options: StorageOptions, token: string) {
    super(options, config.publishMode);
    this.config = config;
    this.api = gitlabClient(config.instanceUrl, token);
  }

  /** The `projects/<id>` prefix every call repeats; the id is a path, so it is encoded whole. */
  private get project(): string {
    return `projects/${encodeURIComponent(this.config.project)}`;
  }

  protected get defaultBranch(): string {
    return this.config.branch;
  }

  protected async checkBranchExists(branch: string): Promise<boolean> {
    return exists(
      this.api.send({ path: `${this.project}/repository/branches/${encodeURIComponent(branch)}` }),
    );
  }

  /**
   * Every blob below `path`. GitLab pages this endpoint and reports the next page
   * in a header, so a repository larger than one page would otherwise be listed
   * down to its first hundred files.
   */
  private async listTree(path: string): Promise<TreeFile[]> {
    const ref = await this.readRef();
    const key = `${ref}:${path}`;
    const cached = this.trees.get(key);

    if (cached) return cached;

    const pending = this.walkTree(path, ref);

    this.trees.set(key, pending);

    return pending;
  }

  private async walkTree(path: string, ref: string): Promise<TreeFile[]> {
    const found: TreeFile[] = [];
    let page = "1";

    try {
      while (page) {
        const response = await this.api.send({
          path: `${this.project}/repository/tree`,
          query: { path, ref, recursive: true, per_page: 100, page },
        });
        const items = (await response.json()) as Array<{ type: string; path: string }>;

        found.push(...items.filter((item) => item.type === "blob"));
        page = response.headers.get("x-next-page") ?? "";
      }
    } catch {
      return [];
    }

    return found;
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (!this.schemas[collection]) return [];
    if (this.isFileCollection(collection)) return this.listFileCollectionEntries(collection);

    const items = await this.listTree(this.getCollectionPath(collection));

    return this.entriesFromTreePaths(
      collection,
      items.map((item) => item.path),
    );
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    return this.fetchFileContent(this.getEntryPath(collection, id, ext));
  }

  /** A repository file's own bytes. GitLab encodes the whole path as one segment. */
  private filePath(path: string): string {
    return `${this.project}/repository/files/${encodeURIComponent(path)}`;
  }

  protected async fetchFileContent(path: string): Promise<string> {
    return this.api.text({
      path: `${this.filePath(path)}/raw`,
      query: { ref: await this.readRef() },
    });
  }

  async listMedia(): Promise<MediaFile[]> {
    return this.mediaFiles(await this.listTree(this.mediaDirectory));
  }

  protected async commitFile(path: string, content: string, message: string): Promise<void> {
    await this.commitUpsert(path, content, message);
  }

  protected async removeFile(path: string, message: string): Promise<void> {
    await this.commit({ action: "delete", file_path: path }, message);
  }

  protected async writeMedia(repoPath: string, bytes: Uint8Array): Promise<void> {
    // An upload replaces whatever is at the path, which GitLab's commit API
    // spells as two different actions; `commitUpsert` is what knows which.
    await this.commitUpsert(repoPath, toBase64(bytes), `Upload ${repoPath}`, "base64");
  }

  /** GitLab has no pre-signed download URL, so the bytes travel through this server. */
  async readMedia(path: string): Promise<MediaContent> {
    return {
      bytes: await this.api.bytes({
        path: `${this.filePath(this.mediaRepoPath(path))}/raw`,
        query: { ref: await this.readRef() },
      }),
      contentType: this.contentTypeOf(path),
    };
  }

  protected async moveMedia(from: string, to: string): Promise<void> {
    await this.commit(
      { action: "move", file_path: to, previous_path: from },
      `Rename ${from} to ${to}`,
    );
  }

  protected async removeMedia(repoPath: string): Promise<void> {
    await this.removeFile(repoPath, `Delete ${repoPath}`);
  }

  protected async doUpdate(branch: string): Promise<void> {
    // GitLab has no direct branch-to-branch merge endpoint; open a transient MR
    // from default into the draft and accept it.
    let iid: number;

    try {
      const created = await this.createMergeRequest(
        this.config.branch,
        branch,
        `Sync ${this.config.branch} into ${branch}`,
        "Auto-merge from Astronaut CMS update.",
      );

      iid = created.iid;
    } catch (err) {
      if (this.isNoCommitsError(err)) return;

      throw err;
    }

    try {
      await this.acceptMergeRequest(iid, {});
    } catch (err) {
      await this.api
        .run({ path: `${this.project}/merge_requests/${iid}`, method: "DELETE" })
        .catch(() => undefined);

      throw err;
    }
  }

  private async compare(from: string, to: string) {
    return this.api.json<{
      commits?: unknown[];
      diffs?: Array<{
        new_path: string;
        old_path: string;
        new_file: boolean;
        deleted_file: boolean;
        renamed_file: boolean;
        diff?: string;
      }>;
    }>({ path: `${this.project}/repository/compare`, query: { from, to } });
  }

  protected async diffAgainstDefault(branch: string): Promise<FileChange[]> {
    const cmp = await this.compare(this.config.branch, branch);

    return (cmp.diffs ?? []).map((diff) => ({
      path: diff.new_path,
      kind: diff.new_file
        ? "added"
        : diff.deleted_file
          ? "deleted"
          : diff.renamed_file
            ? "renamed"
            : "modified",
      previousPath: diff.renamed_file ? diff.old_path : undefined,
      patch: diff.diff || undefined,
    }));
  }

  protected async computeBehind(branch: string): Promise<number> {
    return (await this.compare(branch, this.config.branch)).commits?.length ?? 0;
  }

  protected async findOpenChangeRequest(branch: string): Promise<ChangeRequestSummary | null> {
    const [first] = await this.api.json<MergeRequest[]>({
      path: `${this.project}/merge_requests`,
      query: { source_branch: branch, state: "opened" },
    });

    return first ? summarize(first) : null;
  }

  private async createMergeRequest(
    source: string,
    target: string,
    title: string,
    description: string,
  ): Promise<MergeRequest> {
    return this.api.json<MergeRequest>({
      path: `${this.project}/merge_requests`,
      method: "POST",
      body: { source_branch: source, target_branch: target, title, description },
    });
  }

  protected async createChangeRequest(branch: string): Promise<ChangeRequestSummary> {
    return summarize(
      await this.createMergeRequest(
        branch,
        this.config.branch,
        this.changeRequestTitle(branch),
        this.changeRequestBody(branch),
      ),
    );
  }

  protected async closeChangeRequest(id: number): Promise<void> {
    await this.api.run({
      path: `${this.project}/merge_requests/${id}`,
      method: "PUT",
      body: { state_event: "close" },
    });
  }

  protected async acceptChangeRequest(request: ChangeRequestSummary): Promise<void> {
    await this.acceptMergeRequest(request.id, {
      squash: true,
      should_remove_source_branch: true,
      squash_commit_message: request.title,
    });
  }

  protected async deleteUserBranch(branch: string): Promise<void> {
    await this.api.run({
      path: `${this.project}/repository/branches/${encodeURIComponent(branch)}`,
      method: "DELETE",
    });
  }

  private async commitUpsert(
    path: string,
    content: string,
    message: string,
    encoding?: "base64",
  ): Promise<void> {
    // GitLab's commit API distinguishes create from update, so an upsert has to
    // ask whether the file is already there on the ref it is branching from.
    const present = await exists(
      this.api.send({ path: this.filePath(path), query: { ref: await this.readRef() } }),
    );

    await this.commit(
      { action: present ? "update" : "create", file_path: path, content, encoding },
      message,
    );
  }

  private async commit(action: CommitAction, message: string): Promise<void> {
    const branchExists = await this.branchExists();

    // The listings this request made describe the tree before this commit.
    this.trees.clear();

    await this.api.run({
      path: `${this.project}/repository/commits`,
      method: "POST",
      body: {
        branch: this.branch,
        commit_message: message,
        actions: [action],
        ...(branchExists ? {} : { start_branch: this.config.branch }),
      },
    });

    if (!branchExists) this.markBranchExists(true);
  }

  private async acceptMergeRequest(
    iid: number,
    options: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.api.run({
        path: `${this.project}/merge_requests/${iid}/merge`,
        method: "PUT",
        body: options,
      });
    } catch (err) {
      // merge_status is GitLab's canonical conflict signal; HTTP status is a fallback.
      const mr = await this.api
        .json<MergeRequest>({ path: `${this.project}/merge_requests/${iid}` })
        .catch(() => null);

      if (
        mr?.merge_status === "cannot_be_merged" ||
        mr?.merge_status === "cannot_be_merged_recheck"
      ) {
        throw new MergeConflictError(mr.merge_error ?? undefined);
      }

      throw err;
    }
  }

  private isNoCommitsError(err: unknown): boolean {
    if (getErrorStatus(err) === 409) return true;

    return /no\s+commits|nothing to merge/i.test(err instanceof Error ? err.message : String(err));
  }
}
