import { getToolName } from "ai";
import type { TFunction } from "i18next";
import type { CmsToolUIPart } from "@/client/lib/ai/agent";
import { isRefusal } from "@/shared/tools/types";
import type en from "@/client/i18n/locales/en";

export interface ToolSummary {
  /** One line naming the change, in the vocabulary of the content model. */
  description: string;
  /** Entry the change is about, when the admin can link to it. */
  collection?: string;
  entryId?: string;
}

type Message = (messages: typeof en) => string;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// The per-collection tools are named `writeEntry_<collection>` /
// `editEntry_<collection>`, so the collection comes from the tool name.
const ENTRY_WRITES: Array<[prefix: string, message: Message]> = [
  ["writeEntry_", ($) => $.ai.tools.wrote],
  ["editEntry_", ($) => $.ai.tools.edited],
];

/**
 * Turns a completed write tool call into the sentence a content editor would use
 * for it. Returns null for a read-only call, a call still streaming its input,
 * and a call the validation refused: none of those changed anything, so none of
 * them should read as a change in the conversation.
 */
export function describeToolCall(part: CmsToolUIPart, t: TFunction): ToolSummary | null {
  if (part.state !== "output-available" || isRefusal(part.output)) return null;

  const name = getToolName(part);
  const input = (part.input ?? {}) as Record<string, unknown>;
  const id = text(input.id);
  const collection = text(input.collection);
  const newId = text(input.newId);
  const oldPath = text(input.oldPath);
  const newPath = text(input.newPath);
  const path = text(input.path);

  for (const [prefix, message] of ENTRY_WRITES) {
    if (name.startsWith(prefix) && id) {
      const written = name.slice(prefix.length);

      return {
        description: t(message, { collection: written, id }),
        collection: written,
        entryId: id,
      };
    }
  }

  // Both id-to-id tools read the same way and land the user on the new entry.
  const copied = (message: Message): ToolSummary | null =>
    collection && id && newId
      ? {
          description: t(message, { collection, id, newId }),
          collection,
          entryId: newId,
        }
      : null;

  switch (name) {
    case "deleteEntry":
      return collection && id
        ? { description: t(($) => $.ai.tools.deletedEntry, { collection, id }) }
        : null;

    case "renameEntry":
      return copied(($) => $.ai.tools.renamedEntry);

    case "duplicateEntry":
      return copied(($) => $.ai.tools.duplicatedEntry);

    case "reorderEntries":
      return collection ? { description: t(($) => $.ai.tools.reordered, { collection }) } : null;

    case "renameMedia":
      return oldPath && newPath
        ? { description: t(($) => $.ai.tools.renamedMedia, { oldPath, newPath }) }
        : null;

    case "deleteMedia":
      return path ? { description: t(($) => $.ai.tools.deletedMedia, { path }) } : null;

    default:
      return null;
  }
}
