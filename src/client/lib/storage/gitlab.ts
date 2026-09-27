import { Gitlab } from "@gitbeaker/rest";
import type {
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

interface GitLabConfig {
  project: string;
  branch: string;
  instanceUrl: string;
  publishMode: PublishMode;
}

type CommitAction = {
  action: "create" | "update" | "delete" | "move";
  filePath: string;
  content?: string;
  encoding?: "text" | "base64";
  previousPath?: string;
};

export class GitLabStorage extends BranchedStorage {
  private config: GitLabConfig;
  private cachedApi: ReturnType<GitLabStorage["createApi"]> | null = null;
  private cachedApiToken: string | null = null;

  constructor(config: GitLabConfig, schemas: CollectionManifest, mediaDirectory: string) {
    super(schemas, mediaDirectory, config.publishMode);
    this.config = config;
  }

  private createApi() {
    return new Gitlab({ host: this.config.instanceUrl, oauthToken: getToken() });
  }

  private get api() {
    const token = getToken();
    if (!this.cachedApi || this.cachedApiToken !== token) {
      this.cachedApi = this.createApi();
      this.cachedApiToken = token;
    }
    return this.cachedApi;
  }

  protected get defaultBranch(): string {
    return this.config.branch;
  }

  protected async fetchUsername(): Promise<string> {
    const user = await this.api.Users.showCurrentUser();
    return user.username;
  }

  protected async checkBranchExists(branch: string): Promise<boolean> {
    try {
      await this.api.Branches.show(this.config.project, branch);
      return true;
    } catch {
      return false;
    }
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (!this.schemas[collection]) return [];
    if (this.isFileCollection(collection)) return this.listFileCollectionEntries(collection);

    try {
      const items = await this.api.Repositories.allRepositoryTrees(this.config.project, {
        path: this.getCollectionPath(collection),
        ref: await this.readRef(),
        recursive: true,
      });
      return this.entriesFromTreePaths(
        collection,
        items.filter((item) => item.type === "blob").map((item) => item.path),
      );
    } catch {
      return [];
    }
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    return this.fetchFileContent(this.getEntryPath(collection, id, ext));
  }

  protected async fetchFileContent(filePath: string): Promise<string> {
    const result = await this.api.RepositoryFiles.showRaw(
      this.config.project,
      filePath,
      await this.readRef(),
    );
    if (result instanceof Blob) return result.text();
    return result;
  }

  async listMedia(): Promise<MediaFile[]> {
    try {
      const items = await this.api.Repositories.allRepositoryTrees(this.config.project, {
        path: this.mediaDirectory,
        ref: await this.readRef(),
        recursive: true,
      });
      return this.mediaFiles(items.filter((item) => item.type === "blob"));
    } catch {
      return [];
    }
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
    await this.commitUpsert(path, content, message);
  }

  async deleteEntry(collection: string, id: string): Promise<void> {
    const message = `Delete ${collection}/${id}`;
    if (this.isFileCollection(collection)) {
      const { path, content } = await this.removeFileCollectionEntry(collection, id);
      await this.commitUpsert(path, content, message);
      return;
    }
    const entry = await this.getEntry(collection, id);
    const path = this.getEntryPath(collection, id, entry.format);
    await this.commit({ action: "delete", filePath: path }, message);
  }

  protected async writeMedia(repoPath: string, file: File): Promise<void> {
    // An upload replaces whatever is at the path, which GitLab's commit API
    // spells as two different actions; `commitUpsert` is what knows which.
    await this.commitUpsert(repoPath, await fileToBase64(file), `Upload ${repoPath}`, "base64");
  }

  /** GitLab has no pre-signed download URL, so the caller gets the bytes themselves. */
  async readUrl(path: string): Promise<Blob> {
    const raw = await this.api.RepositoryFiles.showRaw(
      this.config.project,
      this.mediaRepoPath(path),
      await this.readRef(),
    );

    return raw instanceof Blob ? raw : new Blob([raw]);
  }

  protected async moveMedia(from: string, to: string): Promise<void> {
    await this.commit(
      { action: "move", filePath: to, previousPath: from },
      `Rename ${from} to ${to}`,
    );
  }

  protected async removeMedia(repoPath: string): Promise<void> {
    await this.commit({ action: "delete", filePath: repoPath }, `Delete ${repoPath}`);
  }

  async reorderEntries(collection: string, ids: string[]): Promise<void> {
    if (!this.isFileCollection(collection)) {
      throw new Error(`Reorder is only supported for file collections (got "${collection}")`);
    }
    const { path, content } = await this.buildReorderedFileCollection(collection, ids);
    await this.commitUpsert(path, content, `Reorder ${collection}`);
  }

  protected async doUpdate(branch: string): Promise<void> {
    // GitLab has no direct branch→branch merge endpoint; open a transient MR
    // from default → user and accept it.
    const tempTitle = `Sync ${this.config.branch} into ${branch}`;
    let iid: number;
    try {
      const created = await this.api.MergeRequests.create(
        this.config.project,
        this.config.branch,
        branch,
        tempTitle,
        { description: "Auto-merge from Astronaut CMS update." },
      );
      iid = created.iid;
    } catch (err) {
      if (this.isNoCommitsError(err)) return;
      throw err;
    }
    try {
      await this.acceptMergeRequest(iid, {});
    } catch (err) {
      try {
        await this.api.MergeRequests.remove(this.config.project, iid);
      } catch {
        // ignore
      }
      throw err;
    }
  }

  protected async diffAgainstDefault(branch: string): Promise<FileChange[]> {
    const cmp = await this.api.Repositories.compare(
      this.config.project,
      this.config.branch,
      branch,
    );

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
    const cmp = await this.api.Repositories.compare(
      this.config.project,
      branch,
      this.config.branch,
    );
    return cmp.commits?.length ?? 0;
  }

  protected async findOpenChangeRequest(branch: string): Promise<ChangeRequestSummary | null> {
    const existing = await this.api.MergeRequests.all({
      projectId: this.config.project,
      sourceBranch: branch,
      state: "opened",
    });
    const first = existing[0];
    if (!first) return null;
    return { id: first.iid, title: first.title, url: first.web_url };
  }

  protected async createChangeRequest(branch: string): Promise<ChangeRequestSummary> {
    const created = await this.api.MergeRequests.create(
      this.config.project,
      branch,
      this.config.branch,
      this.changeRequestTitle(branch),
      { description: this.changeRequestBody(branch) },
    );
    return { id: created.iid, title: created.title, url: created.web_url };
  }

  protected async closeChangeRequest(id: number): Promise<void> {
    await this.api.MergeRequests.edit(this.config.project, id, { stateEvent: "close" });
  }

  protected async acceptChangeRequest(request: ChangeRequestSummary): Promise<void> {
    await this.acceptMergeRequest(request.id, {
      squash: true,
      shouldRemoveSourceBranch: true,
      squashCommitMessage: request.title,
    });
  }

  protected async deleteUserBranch(branch: string): Promise<void> {
    await this.api.Branches.remove(this.config.project, branch);
  }

  private async commitUpsert(
    path: string,
    content: string,
    message: string,
    encoding?: "base64",
  ): Promise<void> {
    // GitLab's commit API requires distinguishing create vs update; resolve
    // upserts by checking whether the file currently exists on `ref`.
    const branch = await this.getUserBranch();
    const exists = await this.branchExists(branch);
    const ref = exists ? branch : this.config.branch;
    let action: "create" | "update" = "create";
    try {
      await this.api.RepositoryFiles.show(this.config.project, path, ref);
      action = "update";
    } catch {
      action = "create";
    }
    await this.commit({ action, filePath: path, content, encoding }, message);
  }

  private async commit(action: CommitAction, message: string): Promise<void> {
    const branch = await this.getUserBranch();
    const exists = await this.branchExists(branch);
    const options = exists ? undefined : { startBranch: this.config.branch };
    await this.api.Commits.create(this.config.project, branch, message, [action], options);
    if (!exists) this.markBranchExists(true);
  }

  private async acceptMergeRequest(
    iid: number,
    options: { squash?: boolean; shouldRemoveSourceBranch?: boolean; squashCommitMessage?: string },
  ): Promise<void> {
    try {
      await this.api.MergeRequests.accept(this.config.project, iid, options);
    } catch (err) {
      // merge_status is GitLab's canonical conflict signal; HTTP status is a fallback.
      let mergeStatus: string | undefined;
      let mergeError: string | undefined;
      try {
        const mr = await this.api.MergeRequests.show(this.config.project, iid);
        mergeStatus = mr.merge_status;
        mergeError = mr.merge_error ?? undefined;
      } catch {
        // ignore
      }
      if (mergeStatus === "cannot_be_merged" || mergeStatus === "cannot_be_merged_recheck") {
        throw new MergeConflictError(mergeError);
      }
      throw err;
    }
  }

  private isNoCommitsError(err: unknown): boolean {
    if (getErrorStatus(err) === 409) return true;
    const message = err instanceof Error ? err.message : String(err);
    return /no\s+commits|nothing to merge/i.test(message);
  }
}
