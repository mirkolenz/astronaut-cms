/**
 * The tools themselves.
 *
 * Every one is a single call into the server's operation registry, so an agent
 * reaches exactly what the UI reaches and is bound by the same rules. A refusal
 * the content caused comes back as a result rather than a failure: it says what
 * to fix, so the agent corrects and retries, while a real failure (offline, the
 * session lapsed) still surfaces as a failed call.
 *
 * Nothing here runs behind an approval prompt, and nothing publishes: a
 * repository change lands in the pending changeset, which the user reviews and
 * then publishes or discards as a whole, and an object-store deletion is moved
 * to the library's trash prefix rather than dropped. What keeps an agent talked
 * into a destructive call by text it read (an entry body, an attached document)
 * from doing real damage is that the server refuses to remove or move a file
 * anything still references, and only a human who has been shown those
 * references can say otherwise.
 *
 * That last guarantee is what makes the same catalog safe to hand to an agent we
 * did not write. Descriptions and annotations therefore carry their full weight
 * here: an agent arriving over WebMCP has no system prompt of ours, and the tool
 * list is the whole of what it is told.
 */
import { z } from "zod";
import {
  collectionDataSchema,
  collectionEnum,
  collectionFormatEnum,
  collectionPatchSchema,
} from "../collection-schema.ts";
import { componentEntries } from "../component-lookup.ts";
import { ContentValidationError } from "../diagnostics.ts";
import { mediaLibraries, mediaRef } from "../media.ts";
import { unexposable } from "./exposable.ts";
import { singletonIds, type CollectionManifestEntry } from "../types.ts";
import { componentDetails } from "./components.ts";
import { contentModel } from "./content-model.ts";
import {
  defineTool,
  isRefusal,
  type CmsToolSet,
  type ToolContext,
  type ToolRefusal,
} from "./types.ts";

const entryId = z.string().describe('Id of an entry, as listEntries reports it (e.g. "about").');

// A single body edit for partial updates: either replace a 1-based inclusive line
// range, or replace the first occurrence of a substring.
const bodyEdit = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("lines"),
      startLine: z.int().describe("First line to replace, 1-based and inclusive."),
      endLine: z.int().describe("Last line to replace, 1-based and inclusive."),
      text: z.string().describe("Replacement text, which may span any number of lines."),
    }),
    z.object({
      mode: z.literal("replace"),
      find: z.string().describe("Exact text to find. Only the first occurrence is replaced."),
      replace: z.string().describe("Text to put in its place."),
    }),
  ])
  .describe("One edit to the markdown body, by line range or by text replacement.")
  .optional();

type BodyEdit = NonNullable<z.infer<typeof bodyEdit>>;

/**
 * Merges a partial patch into existing data: provided fields are set, `null` (or
 * `undefined`) removes the field, and absent fields are left untouched.
 */
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

/**
 * Applies an optional body edit, returning the new body or an actionable error so
 * the agent can re-read and retry.
 */
function applyBodyEdit(body: string, edit: BodyEdit | undefined): { body: string } | ToolRefusal {
  if (!edit) return { body };

  if (edit.mode === "lines") {
    const lines = body.split("\n");

    if (edit.startLine < 1 || edit.startLine > lines.length || edit.endLine < edit.startLine) {
      return {
        error: `Invalid line range ${edit.startLine}-${edit.endLine} for a ${lines.length}-line body.`,
      };
    }

    const end = Math.min(edit.endLine, lines.length);

    return {
      body: lines
        .toSpliced(edit.startLine - 1, end - edit.startLine + 1, ...edit.text.split("\n"))
        .join("\n"),
    };
  }

  if (!body.includes(edit.find)) return { error: "Body text to replace was not found." };

  // Function replacement so `$`-sequences in `replace` are inserted literally.
  return { body: body.replace(edit.find, () => edit.replace) };
}

/**
 * Refusals, turned into results once for the whole catalog rather than at each
 * tool.
 *
 * Doing it here covers everything a tool does, including the read an edit
 * derives its patch from (which, guarded per call, was the one place a
 * correctable refusal still ended the call outright), and means a tool added
 * later cannot forget to.
 */
function guarded(tools: CmsToolSet): CmsToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input: unknown) => {
          try {
            return await tool.execute(input);
          } catch (error) {
            if (error instanceof ContentValidationError) return { error: error.message };

            throw error;
          }
        },
      },
    ]),
  );
}

/**
 * The catalog, bound to one runtime. Everything a tool needs beyond its own
 * arguments arrives in {@link ToolContext}, which is what lets the same
 * definitions serve the browser and, in time, an MCP server.
 */
export function createCmsTools({ call, config }: ToolContext): CmsToolSet {
  const collection = collectionEnum(config.collections).describe(
    "Name of a content or data collection.",
  );
  const libraries = mediaLibraries(config.media);
  const librarySchema = z
    .enum(libraries)
    .describe("Media library holding the file, as listMedia reports it.");

  // The one id a singleton's tools take, so an agent cannot even ask for another.
  const entryIdOf = (col: CollectionManifestEntry) => {
    const [first, ...rest] = singletonIds(col);

    return first
      ? z.enum([first, ...rest]).describe("Id of the collection's entry, one per language when localized.")
      : entryId;
  };

  /**
   * One full-overwrite tool per collection, carrying that collection's exact
   * data schema and format set. The two kinds differ only in the markdown
   * `body`, so everything they say about themselves is built once above them.
   */
  function writeEntryTool(name: string, col: CollectionManifestEntry) {
    const content = col.type === "content";
    const fields = content ? "frontmatter" : "fields";
    const common = {
      title: `Write ${name} entry`,
      description: `Create or fully overwrite an entry in the "${name}" ${col.type} collection. \`data\` is the entry's ${fields}, described by this tool's schema${content ? ", and `body` its markdown content" : ""}. Use editEntry_${name} to change only part of an existing entry.`,
    };
    const data = collectionDataSchema(col).describe(`Complete ${fields} of the "${name}" entry.`);
    const format = collectionFormatEnum(col).describe(
      "File format to store the entry in, which decides its file extension.",
    );

    if (!content) {
      return defineTool({
        ...common,
        inputSchema: z.object({ id: entryIdOf(col), data, format }),
        execute: ({ id, data, format }) =>
          call("saveEntry", { collection: name, id, entry: { data, body: "", format } }),
      });
    }

    return defineTool({
      ...common,
      inputSchema: z.object({
        id: entryIdOf(col),
        data,
        body: z.string().describe("Complete markdown body, replacing whatever is there."),
        format,
      }),
      execute: ({ id, data, body, format }) =>
        call("saveEntry", { collection: name, id, entry: { data, body, format } }),
    });
  }

  /**
   * One partial-update tool per collection. `data` is a patch (every field
   * optional; set a field to null to remove it), and a content collection also
   * accepts an edit to the markdown `body`, which is what makes its patch
   * optional in turn. Both kinds then save the same way.
   */
  function editEntryTool(name: string, col: CollectionManifestEntry) {
    const content = col.type === "content";
    const fields = content ? "frontmatter fields" : "fields";
    const common = {
      title: `Edit ${name} entry`,
      description: `Partially update an existing entry in the "${name}" ${col.type} collection. \`data\` changes only the ${fields} you provide; set a field to null to remove it.${content ? " `body` edits the markdown by line range or text replacement, and both are optional." : ""}`,
    };
    const data = collectionPatchSchema(col).describe(
      `${content ? "Frontmatter fields" : "Fields"} to change. Omitted fields keep their value; null removes one.`,
    );

    const edit = async (id: string, patch?: Record<string, unknown>, body?: BodyEdit) => {
      const current = await call("getEntry", { collection: name, id });
      const edited = applyBodyEdit(current.body, body);

      if (isRefusal(edited)) return edited;

      // The read this edit is derived from, so a human saving the same entry
      // mid-run refuses the agent's write rather than losing their own.
      return call("saveEntry", {
        collection: name,
        id,
        entry: {
          data: patch ? applyDataPatch(current.data, patch) : current.data,
          body: edited.body,
          format: current.format,
          expectedVersion: current.version,
        },
      });
    };

    if (!content) {
      return defineTool({
        ...common,
        inputSchema: z.object({ id: entryIdOf(col), data }),
        execute: ({ id, data }) => edit(id, data),
      });
    }

    return defineTool({
      ...common,
      inputSchema: z.object({ id: entryIdOf(col), data: data.optional(), body: bodyEdit }),
      execute: ({ id, data, body }) => edit(id, data, body),
    });
  }

  // A collection the integration already warned about is left out rather than
  // offered and then refused: a gateway rejects a request over one bad tool
  // name, so including it would cost the whole catalog rather than that one
  // collection. Reading it still works, through the tools that take a name.
  const entryTools: CmsToolSet = Object.fromEntries(
    Object.entries(config.collections)
      .filter(([name, col]) => unexposable(name, col) === null)
      .flatMap(([name, col]) => [
        [`writeEntry_${name}`, writeEntryTool(name, col)],
        [`editEntry_${name}`, editEntryTool(name, col)],
      ]),
  );

  // Offered only where there is a component to describe, since an empty enum
  // would leave a tool no call could satisfy.
  const componentNames = [...new Set(componentEntries(config.components).map(([name]) => name))];
  const componentTools: CmsToolSet = componentNames.length
    ? {
        getComponents: defineTool({
          title: "Describe MDX components",
          description:
            'Describe MDX components by name: the JSON Schema of their `props` and the prop that names an instance. getContentModel lists every component with what it is for, its kind and its children. In an MDX body a component is a JSX tag with literal props: a string in quotes (`title="Hi"`) and any other value as JSON in braces (`count={3}`, `items={[{ "label": "A" }]}`), never a variable, spread or other expression. A `block` component stands on lines of its own, an `inline` one within a line of text. Between its tags goes markdown with top-level components when its children are "markdown", only its listed child components when they are a set, and nothing when it has none, so the tag closes itself (`<Name />`). A component listing `collections` renders their entries, so what it shows is changed by editing those entries, not the component. Besides components, a body may only use `<div>` and `<span>` with a literal `class`. A body never imports anything, every component is available by name.',
          inputSchema: z.object({
            names: z
              .array(z.enum(componentNames as [string, ...string[]]))
              .min(1)
              .describe("Components to describe, as getContentModel lists them."),
          }),
          annotations: { readOnly: true },
          execute: async ({ names }) => componentDetails(config.components, names),
        }),
      }
    : {};

  return guarded({
    getContentModel: defineTool({
      title: "Describe the content model",
      description:
        "Describe this site's content model: which collections exist, whether each stores data or content, the file formats it accepts, how image and file fields spell a media reference, the site's content languages, and the MDX components an entry body may use. Call this first when you do not already know the site.",
      inputSchema: z.object({}),
      annotations: { readOnly: true },
      execute: async () => contentModel(config),
    }),

    ...componentTools,

    listEntries: defineTool({
      title: "List entries",
      description:
        "List the ids of all entries in a collection. Ids are what every other entry tool takes.",
      inputSchema: z.object({ collection }),
      annotations: { readOnly: true, untrustedOutput: true },
      execute: ({ collection: name }) => call("listEntries", { collection: name }),
    }),

    getEntry: defineTool({
      title: "Read an entry",
      description:
        "Read an entry's full content: its `data` fields, its markdown `body`, the `format` it is stored in and the `version` a write may carry.",
      inputSchema: z.object({ collection, id: entryId }),
      annotations: { readOnly: true, untrustedOutput: true },
      execute: ({ collection: name, id }) => call("getEntry", { collection: name, id }),
    }),

    reorderEntries: defineTool({
      title: "Reorder a collection",
      description:
        "Reorder a collection the content model marks reorderable by giving the complete ordered list of entry ids. Every existing id must appear exactly once.",
      inputSchema: z.object({
        collection,
        ids: z
          .array(entryId)
          .describe("Every id in the collection, in the order they should take."),
      }),
      execute: ({ collection: name, ids }) => call("reorderEntries", { collection: name, ids }),
    }),

    renameEntry: defineTool({
      title: "Rename an entry",
      description:
        "Rename an entry (change its id) while keeping its content. Fails if an entry with the new id already exists, and in a singleton collection.",
      inputSchema: z.object({
        collection,
        id: entryId,
        newId: z.string().describe("Id to move the entry to, which must be free."),
      }),
      execute: ({ collection: name, id, newId }) =>
        call("renameEntry", { collection: name, id, newId }),
    }),

    duplicateEntry: defineTool({
      title: "Duplicate an entry",
      description:
        "Duplicate an entry under a new id, copying its data and body. Fails if an entry with the new id already exists, and in a singleton collection.",
      inputSchema: z.object({
        collection,
        id: entryId.describe("Id of the entry to copy."),
        newId: z.string().describe("Id for the copy, which must be free."),
      }),
      execute: ({ collection: name, id, newId }) =>
        call("duplicateEntry", { collection: name, id, newId }),
    }),

    deleteEntry: defineTool({
      title: "Delete an entry",
      description:
        "Delete an entry. The deletion joins the pending changeset, so a human still reviews it before it is published. Fails in a singleton collection.",
      inputSchema: z.object({ collection, id: entryId }),
      annotations: { destructive: true },
      execute: ({ collection: name, id }) => call("deleteEntry", { collection: name, id }),
    }),

    listMedia: defineTool({
      title: "List media files",
      description:
        "List all media files (images and documents) of every media library. `library` and `path` address a file for renameMedia and deleteMedia; `ref` is the value to write into an image or file field, verbatim.",
      inputSchema: z.object({}),
      annotations: { readOnly: true, untrustedOutput: true },
      // The library addresses a file by its own path, while content stores a
      // reference built from it, so both are reported rather than left to be guessed.
      execute: async () =>
        (
          await Promise.all(
            libraries.map(async (library) =>
              (await call("listMedia", { library })).map((file) => ({
                library,
                ...file,
                ref: mediaRef({ library, path: file.path }, config.media),
              })),
            ),
          )
        ).flat(),
    }),

    renameMedia: defineTool({
      title: "Rename a media file",
      description:
        "Rename or move a media file within its library. Refused while content still references the file, since references keep the old path. Update the entries first.",
      inputSchema: z.object({
        library: librarySchema,
        oldPath: z.string().describe("Current path of the file, as listMedia reports it."),
        newPath: z.string().describe("Path to move it to, in the same form."),
      }),
      annotations: { destructive: true },
      execute: ({ library, oldPath, newPath }) =>
        call("renameMedia", { library, from: oldPath, to: newPath }),
    }),

    deleteMedia: defineTool({
      title: "Delete a media file",
      description:
        "Delete a media file. Refused while content still references it. In an object store the file is moved to the library's trash rather than dropped.",
      inputSchema: z.object({
        library: librarySchema,
        path: z.string().describe("Path of the file, as listMedia reports it."),
      }),
      annotations: { destructive: true },
      execute: (input) => call("deleteMedia", input),
    }),

    getChanges: defineTool({
      title: "List pending changes",
      description:
        "List the changes pending in the current changeset: every file changed since the last publish, with how it changed. Only a human can publish or discard them.",
      inputSchema: z.object({}),
      annotations: { readOnly: true, untrustedOutput: true },
      // The diffs themselves are for the user to read in the review screen; the
      // agent only needs to know what is pending.
      execute: async () =>
        (await call("getChanges", {})).map(({ path, kind, previousPath }) => ({
          path,
          kind,
          previousPath,
        })),
    }),

    ...entryTools,
  });
}
