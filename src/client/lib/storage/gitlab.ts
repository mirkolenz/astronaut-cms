import { Gitlab } from "@gitbeaker/rest";
import type { CollectionInfo, EntryMeta, MediaFile } from "@/shared/types";
import { ALL_FORMATS } from "@/shared/types";
import { StorageBase } from "./base";
import { getToken, getFormat, stripExtension, fileToBase64 } from "./utils";
import type { PendingChange } from "@/client/stores/changes-store";

interface GitLabConfig {
  project: string;
  branch: string;
  instanceUrl: string;
}

export class GitLabStorage extends StorageBase {
  private config: GitLabConfig;

  constructor(
    config: GitLabConfig,
    schemas: Record<string, CollectionInfo>,
    mediaDirectory: string,
  ) {
    super(schemas, mediaDirectory);
    this.config = config;
  }

  private get api() {
    return new Gitlab({
      host: this.config.instanceUrl,
      oauthToken: getToken(),
    });
  }

  async listEntries(collection: string): Promise<EntryMeta[]> {
    if (!this.schemas[collection]) return [];

    const prefix = `src/content/${collection}/`;
    try {
      const items = await this.api.Repositories.allRepositoryTrees(this.config.project, {
        path: `src/content/${collection}`,
        ref: this.config.branch,
        recursive: true,
      });
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
    } catch {
      return [];
    }
  }

  protected async fetchRawEntry(collection: string, id: string, ext: string): Promise<string> {
    const filePath = this.getEntryPath(collection, id, ext);
    const result = await this.api.RepositoryFiles.showRaw(
      this.config.project,
      filePath,
      this.config.branch,
    );
    if (result instanceof Blob) {
      return result.text();
    }
    return result;
  }

  async listMedia(): Promise<MediaFile[]> {
    try {
      const items = await this.api.Repositories.allRepositoryTrees(this.config.project, {
        path: this.mediaDirectory,
        ref: this.config.branch,
        recursive: true,
      });
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

    await this.api.Commits.create(this.config.project, this.config.branch, `Upload ${repoPath}`, [
      {
        action: "create",
        filePath: repoPath,
        content,
        encoding: "base64",
      },
    ]);

    return { path: repoPath, size: file.size, lastModified: "" };
  }

  async replaceMedia(path: string, file: File): Promise<MediaFile> {
    const content = await fileToBase64(file);

    await this.api.Commits.create(this.config.project, this.config.branch, `Replace ${path}`, [
      {
        action: "update",
        filePath: path,
        content,
        encoding: "base64",
      },
    ]);

    return { path, size: file.size, lastModified: "" };
  }

  async renameMedia(oldPath: string, newPath: string): Promise<MediaFile> {
    await this.api.Commits.create(
      this.config.project,
      this.config.branch,
      `Rename ${oldPath} to ${newPath}`,
      [
        {
          action: "move",
          filePath: newPath,
          previousPath: oldPath,
        },
      ],
    );

    return { path: newPath, size: 0, lastModified: "" };
  }

  async deleteMedia(path: string): Promise<void> {
    await this.api.Commits.create(this.config.project, this.config.branch, `Delete ${path}`, [
      {
        action: "delete",
        filePath: path,
      },
    ]);
  }

  protected async doPublish(changes: PendingChange[]): Promise<void> {
    const actions = changes.map((change) => {
      const filePath = this.getEntryPath(change.collection, change.entryId, change.format);

      if (change.action === "delete") {
        return { action: "delete" as const, filePath };
      }

      return {
        action: change.action === "create" ? ("create" as const) : ("update" as const),
        filePath,
        content: change.content ?? "",
      };
    });

    const commitMessage = this.buildCommitMessage(changes.map((c) => c.message));

    await this.api.Commits.create(this.config.project, this.config.branch, commitMessage, actions);
  }
}
