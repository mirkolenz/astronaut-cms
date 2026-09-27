import { tool, type Tool } from "ai";
import { z } from "zod";
import collections from "virtual:astronaut-cms/collections";
import { getStorage } from "@client/lib/storage";
import type { CollectionManifestEntry } from "@shared/types";
import { collectionDataSchema, collectionPatchSchema, collectionFormatEnum } from "./schema";
import { requestConfirmation, type ConfirmRequest } from "./confirm";

// Runs a destructive action behind a user confirmation, owning the shared
// cancelled/ok envelope the system prompt relies on.
async function confirmed(
  request: ConfirmRequest,
  action: () => Promise<void>,
): Promise<{ ok: true } | { cancelled: true }> {
  if (!(await requestConfirmation(request))) return { cancelled: true };

  await action();

  return { ok: true };
}

// The collection set is statically known, so every tool that names a collection
// constrains it to this enum rather than an open string.
const collectionNames = Object.keys(collections);
const collectionEnum =
  collectionNames.length > 0 ? z.enum(collectionNames as [string, ...string[]]) : z.string();

// A single body edit for partial updates: either replace a 1-based inclusive line
// range, or replace the first occurrence of a substring.
const bodyEdit = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("lines"),
    startLine: z.int(),
    endLine: z.int(),
    text: z.string(),
  }),
  z.object({
    mode: z.literal("replace"),
    find: z.string(),
    replace: z.string(),
  }),
]);

type BodyEdit = z.infer<typeof bodyEdit>;

// Merges a partial patch into existing data: provided fields are set, `null`
// (or `undefined`) removes the field, and absent fields are left untouched.
function applyDataPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete result[key];
    else result[key] = value;
  }

  return result;
}

// Applies an optional body edit, returning the new body or an actionable error so
// the model can re-read and retry.
function applyBodyEdit(
  body: string,
  edit: BodyEdit | undefined,
): { body: string } | { error: string } {
  if (!edit) return { body };

  if (edit.mode === "lines") {
    const lines = body.split("\n");

    if (edit.startLine < 1 || edit.startLine > lines.length || edit.endLine < edit.startLine) {
      return {
        error: `Invalid line range ${edit.startLine}-${edit.endLine} for a ${lines.length}-line body.`,
      };
    }

    const end = Math.min(edit.endLine, lines.length);
    lines.splice(edit.startLine - 1, end - edit.startLine + 1, ...edit.text.split("\n"));

    return { body: lines.join("\n") };
  }

  if (!body.includes(edit.find)) {
    return { error: "Body text to replace was not found." };
  }

  // Function replacement so `$`-sequences in `replace` are inserted literally.
  return { body: body.replace(edit.find, () => edit.replace) };
}

// One full-overwrite tool per collection, carrying that collection's exact data
// schema and format set. Content collections add a markdown `body`.
function writeEntryTool(name: string, col: CollectionManifestEntry): Tool {
  const data = collectionDataSchema(col);
  const format = collectionFormatEnum(col);

  if (col.type === "data") {
    return tool({
      description: `Create or fully overwrite an entry in the "${name}" data collection. \`data\` holds the entry's fields, described by this tool's schema. Use editEntry_${name} to change only part of an existing entry.`,
      inputSchema: z.object({ id: z.string(), data, format }),
      execute: async ({ id, data: entryData, format: entryFormat }) => {
        await getStorage().saveEntry(name, id, { data: entryData, body: "", format: entryFormat });

        return { ok: true };
      },
    });
  }

  return tool({
    description: `Create or fully overwrite an entry in the "${name}" content collection. \`data\` is the frontmatter (described by this tool's schema) and \`body\` the markdown content. Use editEntry_${name} to change only part of an existing entry.`,
    inputSchema: z.object({ id: z.string(), data, body: z.string(), format }),
    execute: async ({ id, data: entryData, body, format: entryFormat }) => {
      await getStorage().saveEntry(name, id, { data: entryData, body, format: entryFormat });

      return { ok: true };
    },
  });
}

// One partial-update tool per collection. `data` is a patch (every field optional;
// set a field to null to remove it); content collections also accept a `body` edit.
function editEntryTool(name: string, col: CollectionManifestEntry): Tool {
  const data = collectionPatchSchema(col);

  if (col.type === "data") {
    return tool({
      description: `Partially update an existing entry in the "${name}" data collection. Only the \`data\` fields you provide change; set a field to null to remove it.`,
      inputSchema: z.object({ id: z.string(), data }),
      execute: async ({ id, data: patch }) => {
        const current = await getStorage().getEntry(name, id);

        await getStorage().saveEntry(name, id, {
          data: applyDataPatch(current.data, patch),
          body: current.body,
          format: current.format,
        });

        return { ok: true };
      },
    });
  }

  return tool({
    description: `Partially update an existing entry in the "${name}" content collection. \`data\` changes only the frontmatter fields you provide (set a field to null to remove it); \`body\` edits the markdown by line range or text replacement. Both are optional.`,
    inputSchema: z.object({ id: z.string(), data: data.optional(), body: bodyEdit.optional() }),
    execute: async ({ id, data: patch, body: edit }) => {
      const current = await getStorage().getEntry(name, id);
      const edited = applyBodyEdit(current.body, edit);

      if ("error" in edited) return edited;

      await getStorage().saveEntry(name, id, {
        data: patch ? applyDataPatch(current.data, patch) : current.data,
        body: edited.body,
        format: current.format,
      });

      return { ok: true };
    },
  });
}

const entryTools: Record<string, Tool> = Object.fromEntries(
  Object.entries(collections).flatMap(([name, col]) => [
    [`writeEntry_${name}`, writeEntryTool(name, col)],
    [`editEntry_${name}`, editEntryTool(name, col)],
  ]),
);

// Tools execute in the browser against the same storage backend the UI uses, so
// the agent inherits exactly the user's permissions and the draft-branch + PR
// review flow. Writes go through the per-collection `writeEntry_<collection>` /
// `editEntry_<collection>` tools; destructive operations gate on confirmation.
export const cmsTools = {
  listEntries: tool({
    description: "List the ids of all entries in a collection.",
    inputSchema: z.object({ collection: collectionEnum }),
    execute: ({ collection }) => getStorage().listEntries(collection),
  }),

  getEntry: tool({
    description: "Read an entry's full content: its `data` fields and markdown `body`.",
    inputSchema: z.object({ collection: collectionEnum, id: z.string() }),
    execute: ({ collection, id }) => getStorage().getEntry(collection, id),
  }),

  deleteEntry: tool({
    description: "Delete an entry. Asks the user to confirm first.",
    inputSchema: z.object({ collection: collectionEnum, id: z.string() }),
    execute: ({ collection, id }) =>
      confirmed(
        { title: "Delete entry", message: `Delete "${collection}/${id}"?`, variant: "danger" },
        () => getStorage().deleteEntry(collection, id),
      ),
  }),

  reorderEntries: tool({
    description: "Reorder a collection by giving the complete ordered list of entry ids.",
    inputSchema: z.object({ collection: collectionEnum, ids: z.array(z.string()) }),
    execute: async ({ collection, ids }) => {
      await getStorage().reorderEntries(collection, ids);

      return { ok: true };
    },
  }),

  listMedia: tool({
    description: "List all media files (images and documents).",
    inputSchema: z.object({}),
    execute: () => getStorage().listMedia(),
  }),

  getStatus: tool({
    description: "Get the draft branch status: pending changes and how far it is ahead/behind.",
    inputSchema: z.object({}),
    execute: () => getStorage().getStatus(),
  }),

  publish: tool({
    description:
      "Publish all pending draft changes (merge the draft branch or open a pull request). Asks the user to confirm first.",
    inputSchema: z.object({}),
    execute: () =>
      confirmed({ title: "Publish changes", message: "Publish all pending changes?" }, () =>
        getStorage().publish(),
      ),
  }),

  discard: tool({
    description: "Discard all pending draft changes. Asks the user to confirm first.",
    inputSchema: z.object({}),
    execute: () =>
      confirmed(
        {
          title: "Discard changes",
          message: "Discard all pending changes? This cannot be undone.",
          variant: "danger",
        },
        () => getStorage().discard(),
      ),
  }),

  ...entryTools,
};
