import type { CollectionInfo, EntryContent, CONTENT_FORMATS, DATA_FORMATS } from "@/shared/types";
import { parseContent } from "@/shared/content-parser";
import { validateSegment, validatePath, validateFormat } from "@/shared/validation";
import { StorageBase } from "./base";
import { useChangesStore } from "@/client/stores/changes-store";

export abstract class RemoteStorageBase extends StorageBase {
  protected schemas: Record<string, CollectionInfo>;

  constructor(schemas: Record<string, CollectionInfo>, mediaDirectory: string) {
    super(mediaDirectory);
    this.schemas = schemas;
  }

  async getEntry(collection: string, id: string): Promise<EntryContent> {
    const col = this.schemas[collection];
    if (!col) throw new Error(`Unknown collection: ${collection}`);

    const extensions: readonly string[] =
      col.type === "content"
        ? (["md", "mdx", "mdoc"] satisfies Array<(typeof CONTENT_FORMATS)[number]>)
        : (["json", "yaml", "yml"] satisfies Array<(typeof DATA_FORMATS)[number]>);

    for (const ext of extensions) {
      try {
        const raw = await this.fetchRawEntry(collection, id, ext);
        const { data, body } = parseContent(raw, ext);
        return { id, data, body, format: ext };
      } catch {
        continue;
      }
    }

    throw new Error(`Entry not found: ${collection}/${id}`);
  }

  protected abstract fetchRawEntry(collection: string, id: string, ext: string): Promise<string>;

  async deleteEntry(collection: string, id: string): Promise<void> {
    let format = "";
    try {
      const entry = await this.getEntry(collection, id);
      format = entry.format;
    } catch {
      const pending = useChangesStore
        .getState()
        .changes.find((c) => c.collection === collection && c.entryId === id);
      if (pending) {
        format = pending.format;
      }
    }

    useChangesStore.getState().addChange({
      collection,
      entryId: id,
      action: "delete",
      format,
      message: `Delete ${collection}/${id}`,
    });
  }

  protected getEntryPath(collection: string, entryId: string, format: string): string {
    validateSegment(collection, "collection");
    validatePath(entryId, "entryId");
    validateFormat(format);
    return `src/content/${collection}/${entryId}.${format}`;
  }

  protected buildCommitMessage(messages: string[]): string {
    if (messages.length === 1) return messages[0];
    return `Update ${messages.length} entries\n\n${messages.join("\n")}`;
  }
}
