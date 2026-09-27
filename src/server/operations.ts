/**
 * Everything the CMS can do, in one place.
 *
 * This registry is the security boundary, not the session cookie. A cookie
 * decides *who* is asking; this decides what asking can accomplish. Every
 * operation names a CMS capability — an entry in a collection, a file in the
 * library — and none of them takes a repository path, a ref, a commit or a
 * provider parameter, so a browser that has been fully compromised can still
 * only do the things an editor could have done through the UI, and nothing
 * wider.
 *
 * It is also the only contract: the typed client, the assistant's tools and (in
 * time) an MCP adapter are all projections of this object, so none of them can
 * drift from what the server actually accepts.
 */
import { z } from "zod";
import { client } from "virtual:astronaut-cms/server";
import { collectionEnum } from "../shared/collection-schema.ts";
import { ALL_FORMATS } from "../shared/types.ts";
import { ContentValidationError, diagnostic, type Diagnostic } from "../shared/diagnostics.ts";
import { describeReference, referencesFor, type ReferenceIndex } from "../shared/references.ts";
import { buildReferenceIndex } from "./references.ts";
import { validateReorder } from "./validation.ts";
import { RateLimiter, limited } from "../shared/rate-limit.ts";
import type { RequestContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import { changesetDigest } from "../shared/digest.ts";
import { mediaLibraries, type MediaLocation } from "../shared/media.ts";

/**
 * One operation: a schema for what the caller may send and a handler that runs
 * with the request's context.
 *
 * The input *type* is a phantom, so the browser can type a call from this
 * module's type alone without importing any of it. The schema is kept as a value
 * beside it because it describes the operation to something that has no types at
 * all: it is what an MCP adapter would publish as a tool's input schema.
 */
export interface Operation<I, O> {
  readonly input?: I;
  readonly schema: z.ZodType;
  run(ctx: RequestContext, raw: unknown): Promise<O>;
}

function op<S extends z.ZodType, O>(
  schema: S,
  handler: (ctx: RequestContext, input: z.output<S>) => Promise<O>,
): Operation<z.input<S>, O> {
  return {
    schema,
    run: (ctx, raw) => {
      const parsed = schema.safeParse(raw);

      // Reported as findings rather than as a Zod dump: the assistant reads
      // these back to correct itself, and the editor reads them in a dialog.
      if (!parsed.success) {
        throw new ContentValidationError(
          parsed.error.issues.map((issue) =>
            diagnostic(issue.message, issue.path.join(".") || undefined),
          ),
        );
      }

      return handler(ctx, parsed.data);
    },
  };
}

const ok = { ok: true } as const;

const none = z.object({});

const collection = collectionEnum(client.collections);

const entryRef = z.object({ collection, id: z.string() });

/**
 * The version the caller read, echoed back so a write cannot silently discard
 * one that landed in between. Opaque here: it is handed straight to the backend,
 * which compares it, so nothing in between ever treats it as a ref.
 */
const expectedVersion = z.string().optional();

const rename = entryRef.extend({ newId: z.string() });

const saveRequest = z.object({
  data: z.record(z.string(), z.unknown()),
  body: z.string(),
  format: z.enum(ALL_FORMATS),
  createOnly: z.boolean().optional(),
  expectedVersion,
});

const mediaPathSchema = z.string().min(1);

/** Which library a media operation addresses, refused where the site has no object store. */
const library = z.enum(mediaLibraries(client.media));

const mediaFile = z.object({ library, path: mediaPathSchema });

/**
 * The reference scan reads every entry of every collection, which is by a wide
 * margin the most expensive thing a signed-in caller can ask for: one provider
 * request per entry, against a quota the editor's own token is charged for. The
 * general request budget is far too loose to bound it, so it gets its own —
 * serialized, and rare enough that a person never notices.
 *
 * The admin caches its index for five minutes and passes `force` once it has
 * shown the editor what a file references, so in practice only the assistant
 * reaches this repeatedly.
 */
const scans = new RateLimiter({ requests: 10, windowMs: 60_000, concurrency: 1 });

function scan(ctx: RequestContext): Promise<ReferenceIndex> {
  return limited(
    scans,
    ctx.session.login,
    () => new HttpError("A reference scan is already running. Try again in a moment.", 429),
    () => buildReferenceIndex(ctx.storage),
  );
}

/**
 * Whether the caller may act on a file something still points at.
 *
 * The reference scan reads every entry, so it is not something to run on every
 * click. The admin already holds an index (it shows the editor what references
 * the file before asking), which is what lets a human say yes; nothing that has
 * not seen those references can, which is the case that matters — an assistant
 * talked into a deletion by text it read never sets this.
 */
const acknowledged = z.boolean().default(false);

function assertValid(diagnostics: Diagnostic[]): void {
  if (diagnostics.length > 0) throw new ContentValidationError(diagnostics);
}

/** The single-finding form, which is what every guard below reports. */
function refuse(message: string): never {
  throw new ContentValidationError([diagnostic(message)]);
}

/**
 * The path names a file the library actually holds. Both callers are about to
 * act on it destructively, and "no such key" from a store reads as a failure
 * rather than as the correctable mistake it usually is.
 */
async function assertInLibrary(ctx: RequestContext, { library, path }: MediaLocation): Promise<void> {
  const files = await ctx.media(library).listPaths();

  if (files.some((file) => file.path === path)) return;

  refuse(`"${path}" is not in the ${library} media library. Use a path listMedia reports.`);
}

async function assertUnreferenced(
  ctx: RequestContext,
  location: MediaLocation,
  force: boolean,
): Promise<void> {
  if (force) return;

  const index = await scan(ctx);
  const references = referencesFor(index, location);

  if (references.length === 0) return;

  refuse(
    `"${location.path}" is still referenced by ${references.length} entries: ${references.map(describeReference).join(", ")}. Update them first.`,
  );
}

export const operations = {
  // --- Entries -------------------------------------------------------------

  listEntries: op(z.object({ collection }), (ctx, input) =>
    ctx.storage.listEntries(input.collection),
  ),

  getEntry: op(
    entryRef.extend({ format: z.string().optional() }),
    (ctx, { collection, id, format }) => ctx.storage.getEntry(collection, id, format),
  ),

  /**
   * Answers with the entry's new version rather than a bare acknowledgement, so
   * the editor that saved can save again without re-reading: without it, its
   * next write would carry the version from before this one and be refused as
   * stale.
   */
  saveEntry: op(entryRef.extend({ entry: saveRequest }), async (ctx, { collection, id, entry }) => {
    const version = await ctx.storage.saveEntry(collection, id, entry);

    return { ...ok, ...(version && { version }) };
  }),

  deleteEntry: op(entryRef.extend({ expectedVersion }), async (ctx, input) => {
    await ctx.storage.deleteEntry(input.collection, input.id, input.expectedVersion);

    return ok;
  }),

  renameEntry: op(rename.extend({ expectedVersion }), async (ctx, input) => {
    await ctx.storage.renameEntry(input.collection, input.id, input.newId, input.expectedVersion);

    return ok;
  }),

  /**
   * No `expectedVersion`: the copy lands at an id nothing has read, so there is
   * no version a caller could honestly name. What a duplicate has to be safe
   * against is an occupied destination, which the backend checks. (A rename is
   * the case where one *is* meaningful, and it carries its own.)
   */
  duplicateEntry: op(rename, async (ctx, { collection, id, newId }) => {
    await ctx.storage.duplicateEntry(collection, id, newId);

    return ok;
  }),

  reorderEntries: op(
    z.object({ collection, ids: z.array(z.string()), expectedVersion }),
    async (ctx, input) => {
      const existing = (await ctx.storage.listEntries(input.collection)).map((entry) => entry.id);

      assertValid(validateReorder(existing, input.ids));

      await ctx.storage.reorderEntries(input.collection, input.ids, input.expectedVersion);

      return ok;
    },
  ),

  getFileLayout: op(z.object({ collection }), (ctx, input) =>
    ctx.storage.getFileLayout(input.collection),
  ),

  // --- The changeset -------------------------------------------------------

  getStatus: op(none, (ctx) => ctx.storage.getStatus()),
  getChanges: op(none, (ctx) => ctx.storage.getChanges()),

  // The digest names the changeset the editor reviewed, so anything written
  // after the review, by an agent or another tab, blocks the publish.
  publish: op(z.object({ digest: z.string() }), async (ctx, input) => {
    if (input.digest !== (await changesetDigest(await ctx.storage.getChanges()))) {
      throw new HttpError("The changes were updated after your review. Review them again.", 412);
    }

    await ctx.storage.publish();

    return ok;
  }),

  update: op(none, async (ctx) => {
    await ctx.storage.update();

    return ok;
  }),

  discard: op(none, async (ctx) => {
    await ctx.storage.discard();

    return ok;
  }),

  // --- Media ---------------------------------------------------------------

  listMedia: op(z.object({ library }), async (ctx, input) => ctx.media(input.library).listMedia()),

  beginUpload: op(
    mediaFile.extend({
      size: z.number().int().nonnegative(),
      overwrite: z.boolean().default(false),
    }),
    async (ctx, { library, path, size, overwrite }) =>
      ctx.media(library).beginUpload(path, size, overwrite),
  ),

  /** Within one library: a file never moves to the other, whose references are spelled differently. */
  renameMedia: op(
    z.object({ library, from: mediaPathSchema, to: mediaPathSchema, force: acknowledged }),
    async (ctx, { library, from, to, force }) => {
      const file = { library, path: from };

      await Promise.all([assertInLibrary(ctx, file), assertUnreferenced(ctx, file, force)]);
      await ctx.media(library).renameMedia(from, to);

      return ok;
    },
  ),

  deleteMedia: op(mediaFile.extend({ force: acknowledged }), async (ctx, { force, ...file }) => {
    await Promise.all([assertInLibrary(ctx, file), assertUnreferenced(ctx, file, force)]);
    await ctx.media(file.library).deleteMedia(file.path);

    return ok;
  }),

  /**
   * The deletions still undoable. A repository library answers with none, so the
   * admin can ask unconditionally and show a trash only where there is one.
   */
  listTrash: op(z.object({ library }), async (ctx, input) => ctx.media(input.library).listTrash()),

  restoreMedia: op(z.object({ library, id: z.string() }), async (ctx, { library, id }) => {
    await ctx.media(library).restoreMedia(id);

    return ok;
  }),

  /**
   * Deleting for good, which is the one media call nothing undoes. Offered to
   * the media view alone: the assistant's tools are enumerated by hand, and this
   * is not among them.
   */
  purgeTrash: op(z.object({ library, id: z.string() }), async (ctx, { library, id }) => {
    await ctx.media(library).purgeTrash(id);

    return ok;
  }),

  /** Every entry read once, so the admin can show what reaches each library file. */
  getReferences: op(none, scan),
};

/**
 * Why one operation could not run. Carries the status the admin branches on,
 * because inside a batch there is no HTTP status left to carry it.
 */
export interface OperationError {
  status: number;
  message: string;
  validation?: Diagnostic[];
}

/** What one operation of a batch answers with. */
export type OperationResult = { ok: true; data: unknown } | { ok: false; error: OperationError };

export type Operations = typeof operations;
export type OperationName = keyof Operations;
export type OperationInput<K extends OperationName> = NonNullable<Operations[K]["input"]>;
export type OperationOutput<K extends OperationName> = Awaited<ReturnType<Operations[K]["run"]>>;

/**
 * One operation, as whoever is hosting a projection of this registry performs
 * it: the admin's batched RPC client in the browser, a `dispatch` bound to a
 * request context on the server. Declared here beside the input and output
 * types, so a projection needs this module's types and nothing else.
 */
export type CmsCall = <K extends OperationName>(
  op: K,
  input: OperationInput<K>,
) => Promise<OperationOutput<K>>;

/**
 * Runs one named operation. The name is checked against the registry's own keys
 * rather than looked up directly, so no property of `Object.prototype` can be
 * reached as an operation.
 */
export async function dispatch(
  ctx: RequestContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  if (!Object.hasOwn(operations, name)) {
    throw new HttpError(`Unknown operation: ${name}`, 404);
  }

  // `async` so a schema rejection reaches the caller the same way a backend
  // failure does, rather than throwing out of the call itself.
  return operations[name as OperationName].run(ctx, input);
}
