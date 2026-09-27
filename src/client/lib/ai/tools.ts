import { tool } from "ai";
import { z } from "zod";
import { getStorage } from "@client/lib/storage";
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

// Tools execute in the browser against the same storage backend the UI uses, so
// the agent inherits exactly the user's permissions and the draft-branch + PR
// review flow. Destructive operations gate on an explicit user confirmation.
export const cmsTools = {
  listEntries: tool({
    description: "List the ids of all entries in a collection.",
    inputSchema: z.object({ collection: z.string() }),
    execute: ({ collection }) => getStorage().listEntries(collection),
  }),

  getEntry: tool({
    description: "Read an entry's full content: its `data` fields and markdown `body`.",
    inputSchema: z.object({ collection: z.string(), id: z.string() }),
    execute: ({ collection, id }) => getStorage().getEntry(collection, id),
  }),

  saveEntry: tool({
    description:
      "Create or overwrite an entry. `data` holds the frontmatter/data fields, `body` the markdown content (empty for data collections), `format` the file extension (md, mdx, json, yaml, toml).",
    inputSchema: z.object({
      collection: z.string(),
      id: z.string(),
      data: z.record(z.string(), z.unknown()),
      body: z.string(),
      format: z.string(),
    }),
    execute: async ({ collection, id, data, body, format }) => {
      await getStorage().saveEntry(collection, id, { data, body, format });

      return { ok: true };
    },
  }),

  deleteEntry: tool({
    description: "Delete an entry. Asks the user to confirm first.",
    inputSchema: z.object({ collection: z.string(), id: z.string() }),
    execute: ({ collection, id }) =>
      confirmed(
        { title: "Delete entry", message: `Delete "${collection}/${id}"?`, variant: "danger" },
        () => getStorage().deleteEntry(collection, id),
      ),
  }),

  reorderEntries: tool({
    description: "Reorder a collection by giving the complete ordered list of entry ids.",
    inputSchema: z.object({ collection: z.string(), ids: z.array(z.string()) }),
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
};
