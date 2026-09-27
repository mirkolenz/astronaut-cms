import { tool, type Tool } from "ai";
import { z } from "zod";
import collections from "virtual:astronaut-cms/collections";
import config from "virtual:astronaut-cms/config";
import { mediaRef } from "@shared/media";
import { getStorage } from "@client/lib/storage";
import { getMedia } from "@client/lib/media";
import { validateNoReferences } from "@client/lib/media/references";
import type { CollectionManifestEntry, SaveEntryRequest } from "@shared/types";
import {
  collectionDataSchema,
  collectionPatchSchema,
  collectionFormatEnum,
} from "@client/lib/schema";
import {
  validateReorder,
  validateMediaExists,
  ContentValidationError,
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

// Storage validates every write, so a refusal comes back as a thrown
// ContentValidationError. Turning it into a result keeps it in the model's loop
// (it says exactly what to fix, so the model corrects and retries), while a real
// failure — offline, no write access — still surfaces as a failed tool call.
async function saveEntry(collection: string, id: string, entry: SaveEntryRequest) {
  try {
    await getStorage().saveEntry(collection, id, entry);

    return { ok: true };
  } catch (error) {
    if (error instanceof ContentValidationError) return { error: error.message };

    throw error;
  }
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
      execute: ({ id, data: entryData, format: entryFormat }) =>
        saveEntry(name, id, { data: entryData, body: "", format: entryFormat }),
    });
  }

  return tool({
    description: `Create or fully overwrite an entry in the "${name}" content collection. \`data\` is the frontmatter (described by this tool's schema) and \`body\` the markdown content. Use editEntry_${name} to change only part of an existing entry.`,
    inputSchema: z.object({ id: z.string(), data, body: z.string(), format }),
    execute: ({ id, data: entryData, body, format: entryFormat }) =>
      saveEntry(name, id, { data: entryData, body, format: entryFormat }),
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

        return saveEntry(name, id, {
          data: applyDataPatch(current.data, patch),
          body: current.body,
          format: current.format,
        });
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

      return saveEntry(name, id, {
        data: patch ? applyDataPatch(current.data, patch) : current.data,
        body: edited.body,
        format: current.format,
      });
    },
  });
}

const entryTools: Record<string, Tool> = Object.fromEntries(
  Object.entries(collections).flatMap(([name, col]) => [
    [`writeEntry_${name}`, writeEntryTool(name, col)],
    [`editEntry_${name}`, editEntryTool(name, col)],
  ]),
);

/**
 * The tools that only read. Calling one changes nothing, so it neither
 * invalidates cached content nor appears as a change in the conversation.
 */
export const readOnlyTools: ReadonlySet<string> = new Set([
  "listEntries",
  "getEntry",
  "listMedia",
  "getChanges",
]);

// Tools execute in the browser against the same storage backend the UI uses, so
// the agent inherits exactly the user's permissions and the draft-branch + PR
// review flow. Writes go through the per-collection `writeEntry_<collection>` /
// `editEntry_<collection>` tools.
//
// No tool runs behind an approval prompt, and none of them publishes: every
// change lands in the pending changeset, which the user reviews and then
// publishes or discards as a whole. Deleting is as reversible as any other
// change there, so it needs no separate gate.
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
    description:
      "List all media files (images and documents). `path` addresses a file for renameMedia and deleteMedia; `ref` is the value to write into an image or file field.",
    inputSchema: z.object({}),
    // The library addresses a file by its own path, while content stores a
    // reference built from it, so both are reported rather than left to be guessed.
    execute: async () =>
      (await getMedia().listMedia()).map((file) => ({ ...file, ref: mediaRef(file.path, config) })),
  }),

  renameMedia: tool({
    description:
      "Rename or move a media file. Pass its current path (as returned by listMedia) and the new path. Refused while content still references the file, since references keep the old path.",
    inputSchema: z.object({ oldPath: z.string(), newPath: z.string() }),
    execute: async ({ oldPath, newPath }) => {
      const invalid = toErrorResult(await validateMediaExists(getMedia(), oldPath));

      if (invalid) return invalid;

      const referenced = toErrorResult(await validateNoReferences(oldPath));

      if (referenced) return referenced;

      await getMedia().renameMedia(oldPath, newPath);

      return { ok: true };
    },
  }),

  getChanges: tool({
    description:
      "List the changes pending in the current changeset: every file changed since the last publish, with how it changed.",
    inputSchema: z.object({}),
    execute: async () => {
      // The diffs themselves are for the user to read in the review screen; the
      // model only needs to know what is pending.
      return (await getStorage().getChanges()).map(({ path, kind, previousPath }) => ({
        path,
        kind,
        previousPath,
      }));
    },
  }),

  deleteEntry: tool({
    description: "Delete an entry.",
    inputSchema: z.object({ collection: collectionEnum, id: z.string() }),
    execute: async ({ collection, id }) => {
      await getStorage().deleteEntry(collection, id);

      return { ok: true };
    },
  }),

  deleteMedia: tool({
    description: "Delete a media file. Refused while content still references it.",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const invalid = toErrorResult(await validateMediaExists(getMedia(), path));

      if (invalid) return invalid;

      const referenced = toErrorResult(await validateNoReferences(path));

      if (referenced) return referenced;

      await getMedia().deleteMedia(path);

      return { ok: true };
    },
  }),

  ...entryTools,
};
