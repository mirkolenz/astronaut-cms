import { join } from "pathe";
import { z } from "zod";
import type { EntryMeta, FileChange, MediaFile } from "../../shared/types.ts";
import { BranchedStorage, fromBase64, type StorageOptions } from "./base.ts";
import type {
  ChangeRequestSummary,
  MediaContent,
  Precondition,
  PublishMode,
  VersionedContent,
} from "./types.ts";
import { MergeConflictError, exists, getErrorStatus, staleWrite } from "./types.ts";
import { ApiClient } from "./api.ts";
import { fetchRange } from "../ranges.ts";
import type { ByteRange } from "../../shared/http.ts";
import { joinUrl } from "../../shared/url.ts";

export interface GitLabConfig {
  project: string;
  branch: string;
  instanceUrl: string;
  publishMode: PublishMode;
}

/** The GitLab API of one instance, with the caller's token attached. */
export function gitlabClient(instanceUrl: string, token: string, api = "api/v4"): ApiClient {
  return new ApiClient(joinUrl(instanceUrl, api), {
    authorization: `Bearer ${token}`,
  });
}

/** One blob of a repository tree, reduced to what a listing needs. */
interface TreeFile {
  path: string;
  size?: number;
  /** The blob hash, which names the contents and so can address them. */
  version?: string;
}

/** A page of the repository tree API. */
const treeSchema = z.array(z.object({ type: z.string(), path: z.string(), id: z.string() }));

/**
 * The tree API reports no sizes, so they come from GraphQL, which names many
 * blobs per request. `rawSize` is the file itself where the blob is an LFS
 * pointer. Both are `BigInt` scalars, which GitLab serializes as strings.
 */
const BLOB_SIZES = `query ($project: ID!, $ref: String!, $paths: [String!]!) {
  project(fullPath: $project) {
    repository { blobs(ref: $ref, paths: $paths) { nodes { path size rawSize } } }
  }
}`;

const blobSizesSchema = z.object({
  data: z
    .object({
      project: z
        .object({
          repository: z.object({
            blobs: z.object({
              nodes: z.array(
                z.object({ path: z.string(), size: z.coerce.number(), rawSize: z.coerce.number().nullish() }),
              ),
            }),
          }),
        })
        .nullable(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/** How many blobs one size query names, well inside GitLab's query complexity limit. */
const BLOB_BATCH = 100;

/** One action of a commit, in the shape GitLab's commits API takes. */
interface CommitAction {
  action: "create" | "update" | "delete" | "move";
  file_path: string;
  content?: string;
  encoding?: "text" | "base64";
  previous_path?: string;
  /**
   * The commit the edit was based on. GitLab refuses the whole commit when the
   * file has moved on since, which is the precondition this backend enforces
   * with; it is also what `last_commit_id` on a read reports.
   */
  last_commit_id?: string;
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
  private readonly graphql: ApiClient;

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
    this.graphql = gitlabClient(config.instanceUrl, token, "api/graphql");
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

    while (page) {
      const response = await this.api.send({
        path: `${this.project}/repository/tree`,
        query: { path, ref, recursive: true, per_page: 100, page },
      });
      const items = treeSchema.parse(await response.json());

      found.push(
        ...items
          .filter((item) => item.type === "blob")
          .map((item) => ({ path: item.path, version: item.id })),
      );
      page = response.headers.get("x-next-page") ?? "";
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

  /** A repository file's own bytes. GitLab encodes the whole path as one segment. */
  private filePath(path: string): string {
    return `${this.project}/repository/files/${encodeURIComponent(path)}`;
  }

  /**
   * The JSON form rather than `/raw`: it carries `last_commit_id` beside the
   * bytes, so a read costs one request and still knows what state it saw.
   */
  protected override async fetchFileContent(path: string): Promise<VersionedContent> {
    const file = await this.api.json<{ content: string; last_commit_id: string }>({
      path: this.filePath(path),
      query: { ref: await this.readRef() },
    });

    return { content: fromBase64(file.content), version: file.last_commit_id };
  }

  /** The tree alone, which names every file but none of their sizes. */
  override async listPaths(): Promise<MediaFile[]> {
    return this.mediaFiles(await this.listTree(this.mediaDirectory));
  }

  async listMedia(): Promise<MediaFile[]> {
    const files = await this.listPaths();
    const repoPath = (file: MediaFile): string => join(this.mediaDirectory, file.path);
    const sizes = await this.blobSizes(files.map(repoPath));

    return files.map((file) => ({ ...file, size: sizes.get(repoPath(file)) ?? 0 }));
  }

  /** The size of each blob at `paths`, batched, since a size is what an upload limit is checked against. */
  private async blobSizes(paths: string[]): Promise<Map<string, number>> {
    const ref = await this.readRef();
    const batches = await Promise.all(
      Array.from({ length: Math.ceil(paths.length / BLOB_BATCH) }, async (_, i) => {
        const { data, errors } = blobSizesSchema.parse(
          await this.graphql.json({
            path: "",
            method: "POST",
            body: {
              query: BLOB_SIZES,
              variables: {
                project: this.config.project,
                ref,
                paths: paths.slice(i * BLOB_BATCH, (i + 1) * BLOB_BATCH),
              },
            },
          }),
        );

        if (errors?.length) throw new Error(`GitLab: ${errors.map((e) => e.message).join("; ")}`);

        return data?.project?.repository.blobs.nodes ?? [];
      }),
    );

    return new Map(batches.flat().map((blob) => [blob.path, blob.rawSize ?? blob.size]));
  }

  protected async commitFile(
    path: string,
    content: string,
    message: string,
    precondition?: Precondition,
  ): Promise<string | undefined> {
    return this.commitUpsert(path, content, message, undefined, precondition);
  }

  protected async removeFile(
    path: string,
    message: string,
    expectedVersion?: string,
  ): Promise<void> {
    await this.commit(
      {
        action: "delete",
        file_path: path,
        ...(expectedVersion !== undefined && { last_commit_id: expectedVersion }),
      },
      message,
    );
  }

  protected async writeMedia(repoPath: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    // An upload replaces whatever is at the path, which GitLab's commit API
    // spells as two different actions; `commitUpsert` is what knows which.
    await this.commitUpsert(repoPath, bytes.toBase64(), `Upload ${repoPath}`, "base64");
  }

  /**
   * GitLab has no pre-signed download URL, so the bytes travel through this
   * server, streamed and relayed through {@link fetchRange} exactly as GitHub's
   * are when the route proxies its download URL.
   */
  async readMedia(path: string, range?: ByteRange): Promise<MediaContent> {
    const ref = await this.readRef();
    const { headers, ...bytes } = await fetchRange(
      (forwarded) =>
        this.api.send({
          path: `${this.filePath(this.mediaRepoPath(path))}/raw`,
          query: { ref },
          headers: forwarded,
          allow: [416],
        }),
      range,
    );

    return {
      ...bytes,
      contentType: this.contentTypeOf(path),
      // Read off the response rather than asked for: GitLab documents this
      // header on the file endpoints, and where it is absent the route simply
      // falls back to the short cache.
      version: headers.get("x-gitlab-blob-id") ?? undefined,
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
    // from default into the draft and accept it. An MR with nothing to merge is refused.
    if ((await this.computeBehind(branch)) === 0) return;

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
      // A transient MR from a concurrent update already covers this one.
      if (getErrorStatus(err) === 409) return;

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
      commit?: { id: string } | null;
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
      // GitLab names no blob per file, so a file without a diff is pinned to the
      // branch head instead and counts as changed by any later commit.
      version: diff.diff ? undefined : cmp.commit?.id,
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
    precondition?: Precondition,
  ): Promise<string | undefined> {
    // GitLab's commit API distinguishes create from update, so an upsert has to
    // know whether the file is already there on the ref it is branching from.
    // The precondition answers that on its own wherever it has one: a version
    // can only have come from reading the file, and requiring absence is the
    // create. Only a write with neither pays for the probe.
    const version = precondition && "version" in precondition ? precondition.version : undefined;
    const present =
      precondition === undefined
        ? await exists(
            this.api.send({ path: this.filePath(path), query: { ref: await this.readRef() } }),
          )
        : version !== undefined;

    return this.commit(
      {
        action: present ? "update" : "create",
        file_path: path,
        content,
        encoding,
        // Only on an update: a create has no prior state to have moved on, and
        // GitLab rejects the field outright when the file is not there.
        ...(present && version !== undefined && { last_commit_id: version }),
      },
      message,
    );
  }

  private async commit(action: CommitAction, message: string): Promise<string | undefined> {
    const branchExists = await this.branchExists();

    // The listings this request made describe the tree before this commit.
    this.trees.clear();

    let created: { id?: string };
    try {
      created = await this.api.json<{ id?: string }>({
        path: `${this.project}/repository/commits`,
        method: "POST",
        body: {
          branch: this.branch,
          commit_message: message,
          actions: [action],
          ...(branchExists ? {} : { start_branch: this.config.branch }),
        },
      });
    } catch (err) {
      // GitLab refuses both a stale `last_commit_id` and a create onto an
      // occupied path with a 400 that reads like any other bad request, so the
      // precondition the action carries is what identifies it. A create is
      // itself a precondition: the path has to be absent for it to succeed.
      const precondition = action.action === "create" || action.last_commit_id !== undefined;

      if (precondition && getErrorStatus(err) === 400) throw staleWrite(action.file_path);

      throw err;
    }

    if (!branchExists) this.markBranchExists(true);

    // The commit that just landed, which is what `last_commit_id` for this file
    // now is — so the editor that wrote it can write again without re-reading.
    return created.id;
  }

  private async acceptMergeRequest(iid: number, options: Record<string, unknown>): Promise<void> {
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
}
