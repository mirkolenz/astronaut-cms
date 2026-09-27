import { tool, type Tool, type ToolApprovalConfiguration } from "ai";
import { z } from "zod";
import collections from "virtual:astronaut-cms/collections";
import { getStorage } from "@client/lib/storage";
import type { CollectionManifestEntry } from "@shared/types";
import { collectionDataSchema, collectionPatchSchema, collectionFormatEnum } from "./schema";
import {
  validateEntryWrite,
  validateReorder,
  validateMediaExists,
  commitWithDiagnostics,
  toErrorResult,
} from "@client/lib/validation";

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
        const diagnostics = await validateEntryWrite({
          col,
          id,
          data: entryData,
          body: "",
          format: entryFormat,
          skipBody: true,
        });

        return commitWithDiagnostics(diagnostics, () =>
          getStorage().saveEntry(name, id, { data: entryData, body: "", format: entryFormat }),
        );
      },
    });
  }

  return tool({
    description: `Create or fully overwrite an entry in the "${name}" content collection. \`data\` is the frontmatter (described by this tool's schema) and \`body\` the markdown content. Use editEntry_${name} to change only part of an existing entry.`,
    inputSchema: z.object({ id: z.string(), data, body: z.string(), format }),
    execute: async ({ id, data: entryData, body, format: entryFormat }) => {
      const diagnostics = await validateEntryWrite({
        col,
        id,
        data: entryData,
        body,
        format: entryFormat,
      });

      return commitWithDiagnostics(diagnostics, () =>
        getStorage().saveEntry(name, id, { data: entryData, body, format: entryFormat }),
      );
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
        const storage = getStorage();
        const current = await storage.getEntry(name, id);
        const merged = applyDataPatch(current.data, patch);

        const diagnostics = await validateEntryWrite({
          col,
          id,
          data: merged,
          body: "",
          format: current.format,
          skipId: true,
          skipBody: true,
          changedDataKeys: Object.keys(patch),
        });

        return commitWithDiagnostics(diagnostics, () =>
          storage.saveEntry(name, id, { data: merged, body: current.body, format: current.format }),
        );
      },
    });
  }

  return tool({
    description: `Partially update an existing entry in the "${name}" content collection. \`data\` changes only the frontmatter fields you provide (set a field to null to remove it); \`body\` edits the markdown by line range or text replacement. Both are optional.`,
    inputSchema: z.object({ id: z.string(), data: data.optional(), body: bodyEdit.optional() }),
    execute: async ({ id, data: patch, body: edit }) => {
      const storage = getStorage();
      const current = await storage.getEntry(name, id);
      const edited = applyBodyEdit(current.body, edit);

      if ("error" in edited) return edited;

      const merged = patch ? applyDataPatch(current.data, patch) : current.data;

      const diagnostics = await validateEntryWrite({
        col,
        id,
        data: merged,
        body: edited.body,
        format: current.format,
        skipId: true,
        skipBody: edit === undefined,
        changedDataKeys: patch ? Object.keys(patch) : [],
      });

      return commitWithDiagnostics(diagnostics, () =>
        storage.saveEntry(name, id, { data: merged, body: edited.body, format: current.format }),
      );
    },
  });
}

const entryTools: Record<string, Tool> = Object.fromEntries(
  Object.entries(collections).flatMap(([name, col]) => [
    [`writeEntry_${name}`, writeEntryTool(name, col)],
    [`editEntry_${name}`, editEntryTool(name, col)],
  ]),
);

// Destructive tools. Membership in this object is what marks a tool as
// approval-gated: `cmsToolApproval` is derived from its keys, so a tool cannot
// be renamed or added here without its approval policy following along.
const destructiveTools = {
  deleteEntry: tool({
    description: "Delete an entry. Requires user approval before it runs.",
    inputSchema: z.object({ collection: collectionEnum, id: z.string() }),
    execute: async ({ collection, id }) => {
      await getStorage().deleteEntry(collection, id);

      return { ok: true };
    },
  }),

  deleteMedia: tool({
    description: "Delete a media file. Requires user approval before it runs.",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const invalid = toErrorResult(await validateMediaExists(path));

      if (invalid) return invalid;

      await getStorage().deleteMedia(path);

      return { ok: true };
    },
  }),

  publish: tool({
    description:
      "Publish all pending draft changes (merge the draft branch or open a pull request). Requires user approval before it runs.",
    inputSchema: z.object({}),
    execute: async () => {
      await getStorage().publish();

      return { ok: true };
    },
  }),

  discard: tool({
    description: "Discard all pending draft changes. Requires user approval before it runs.",
    inputSchema: z.object({}),
    execute: async () => {
      await getStorage().discard();

      return { ok: true };
    },
  }),
};

// Tools execute in the browser against the same storage backend the UI uses, so
// the agent inherits exactly the user's permissions and the draft-branch + PR
// review flow. Writes go through the per-collection `writeEntry_<collection>` /
// `editEntry_<collection>` tools.
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

  reorderEntries: tool({
    description: "Reorder a collection by giving the complete ordered list of entry ids.",
    inputSchema: z.object({ collection: collectionEnum, ids: z.array(z.string()) }),
    execute: async ({ collection, ids }) => {
      const storage = getStorage();
      const existing = (await storage.listEntries(collection)).map((e) => e.id);
      const invalid = toErrorResult(validateReorder(existing, ids));

      if (invalid) return invalid;

      await storage.reorderEntries(collection, ids);

      return { ok: true };
    },
  }),

  renameEntry: tool({
    description:
      "Rename an entry (change its id) while keeping its content. Fails if an entry with the new id already exists.",
    inputSchema: z.object({ collection: collectionEnum, id: z.string(), newId: z.string() }),
    execute: async ({ collection, id, newId }) => {
      await getStorage().renameEntry(collection, id, newId);

      return { ok: true };
    },
  }),

  duplicateEntry: tool({
    description:
      "Duplicate an entry under a new id, copying its data and body. Fails if an entry with the new id already exists.",
    inputSchema: z.object({ collection: collectionEnum, id: z.string(), newId: z.string() }),
    execute: async ({ collection, id, newId }) => {
      await getStorage().duplicateEntry(collection, id, newId);

      return { ok: true };
    },
  }),

  listMedia: tool({
    description: "List all media files (images and documents).",
    inputSchema: z.object({}),
    execute: () => getStorage().listMedia(),
  }),

  renameMedia: tool({
    description:
      "Rename or move a media file. Pass its current path (as returned by listMedia) and the new path.",
    inputSchema: z.object({ oldPath: z.string(), newPath: z.string() }),
    execute: async ({ oldPath, newPath }) => {
      const invalid = toErrorResult(await validateMediaExists(oldPath));

      if (invalid) return invalid;

      await getStorage().renameMedia(oldPath, newPath);

      return { ok: true };
    },
  }),

  getStatus: tool({
    description: "Get the draft branch status: pending changes and how far it is ahead/behind.",
    inputSchema: z.object({}),
    execute: () => getStorage().getStatus(),
  }),

  ...destructiveTools,
  ...entryTools,
};

// Approval is configured per call in AI SDK 7 rather than on the tool: the SDK
// emits an approval request for these calls and only executes them once the user
// approves.
export const cmsToolApproval: ToolApprovalConfiguration<typeof cmsTools, never> = Object.fromEntries(
  Object.keys(destructiveTools).map((name) => [name, "user-approval"] as const),
);
