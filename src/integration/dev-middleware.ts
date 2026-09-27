import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, writeFile, unlink, stat, mkdir, rename } from "node:fs/promises";
import { join, dirname, resolve } from "pathe";
import type { Plugin, ViteDevServer } from "vite";
import {
  ALL_FORMATS,
  type CollectionManifest,
  type EntryMeta,
  type EntryContent,
  type MediaFile,
  type SaveEntryRequest,
} from "../shared/types.ts";
import {
  parseContent,
  serializeContent,
  parseMultiEntryFile,
  serializeMultiEntryFile,
  getFileExtension,
} from "../shared/content-parser.ts";

type NextFn = () => void;

const MUTATING_METHODS = new Set(["PUT", "POST", "PATCH", "DELETE"]);

// How long after a CMS write to keep suppressing the dev-server reload it
// triggers. Generous enough to cover the file-watcher latency, short enough that
// a manual edit moments later still reloads.
const SUPPRESS_WINDOW_MS = 2000;

export interface DevMiddlewareOptions {
  basePath: string;
  contentDir: string;
  mediaDir: string;
  mediaPrefix: string;
  allowedMediaExtensions: string[];
  rootDir: string;
  collections?: CollectionManifest;
}

function isWithin(filePath: string, baseDir: string): boolean {
  const resolved = resolve(filePath);
  const resolvedBase = resolve(baseDir);
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + "/");
}

function assertWithinBase(filePath: string, baseDir: string): void {
  if (!isWithin(filePath, baseDir)) {
    throw new Error("Path escapes the allowed directory");
  }
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, { error: message }, status);
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
}

async function walkDir(
  dir: string,
  formats: readonly string[],
  prefix = "",
): Promise<{ path: string; name: string; format: string }[]> {
  const results: { path: string; name: string; format: string }[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkDir(fullPath, formats, `${prefix}${entry.name}/`);
      results.push(...nested);
    } else {
      const format = formats.find((f) => entry.name.endsWith(`.${f}`));
      if (format) {
        results.push({
          path: `${prefix}${entry.name}`,
          name: entry.name,
          format,
        });
      }
    }
  }
  return results;
}

// --- Glob collection helpers (one entry = one file) ---

async function listGlobEntries(contentDir: string, collection: string): Promise<EntryMeta[]> {
  const collectionDir = join(contentDir, collection);
  assertWithinBase(collectionDir, contentDir);
  const files = await walkDir(collectionDir, ALL_FORMATS);
  return files.map((f) => ({
    id: f.path.slice(0, -(f.format.length + 1)),
    collection,
    format: f.format,
  }));
}

async function findEntryFile(
  contentDir: string,
  collection: string,
  id: string,
): Promise<{ filePath: string; format: string; content: string } | null> {
  for (const format of ALL_FORMATS) {
    const filePath = join(contentDir, collection, `${id}.${format}`);
    assertWithinBase(filePath, contentDir);
    try {
      const content = await readFile(filePath, "utf-8");
      return { filePath, format, content };
    } catch {
      // try next format
    }
  }
  return null;
}

async function getGlobEntry(
  contentDir: string,
  collection: string,
  id: string,
): Promise<EntryContent | null> {
  const found = await findEntryFile(contentDir, collection, id);
  if (!found) return null;

  const { data, body } = parseContent(found.content, found.format);
  return { id, data, body, format: found.format };
}

async function saveGlobEntry(
  contentDir: string,
  collection: string,
  id: string,
  request: SaveEntryRequest,
): Promise<void> {
  const filePath = join(contentDir, collection, `${id}.${request.format}`);
  assertWithinBase(filePath, contentDir);
  const content = serializeContent(request.data, request.body, request.format);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

async function deleteGlobEntry(
  contentDir: string,
  collection: string,
  id: string,
): Promise<void> {
  const found = await findEntryFile(contentDir, collection, id);
  if (!found) throw new Error(`Entry ${collection}/${id} not found`);
  await unlink(found.filePath);
}

// --- File collection helpers (all entries in a single file) ---

function resolveFilePath(rootDir: string, loaderFileName: string): string {
  const filePath = join(rootDir, loaderFileName);
  assertWithinBase(filePath, rootDir);
  return filePath;
}

function getFileFormat(loaderFileName: string): string {
  return getFileExtension(loaderFileName);
}

async function readFileCollection(filePath: string, format: string) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return parseMultiEntryFile(raw, format);
  } catch {
    return { entries: {} as Record<string, Record<string, unknown>>, layout: "object" as const };
  }
}

async function listFileEntries(
  rootDir: string,
  collection: string,
  loaderFileName: string,
): Promise<EntryMeta[]> {
  const filePath = resolveFilePath(rootDir, loaderFileName);
  const format = getFileFormat(loaderFileName);
  const { entries } = await readFileCollection(filePath, format);
  return Object.keys(entries).map((id) => ({
    id,
    collection,
    format,
  }));
}

async function getFileEntry(
  rootDir: string,
  id: string,
  loaderFileName: string,
): Promise<EntryContent | null> {
  const filePath = resolveFilePath(rootDir, loaderFileName);
  const format = getFileFormat(loaderFileName);
  const { entries } = await readFileCollection(filePath, format);
  const entry = entries[id];
  if (!entry) return null;
  return { id, data: entry, body: "", format };
}

async function saveFileEntry(
  rootDir: string,
  id: string,
  data: Record<string, unknown>,
  loaderFileName: string,
): Promise<void> {
  const filePath = resolveFilePath(rootDir, loaderFileName);
  const format = getFileFormat(loaderFileName);
  const { entries, layout } = await readFileCollection(filePath, format);
  entries[id] = data;
  const content = serializeMultiEntryFile(entries, format, layout);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

async function deleteFileEntry(
  rootDir: string,
  id: string,
  loaderFileName: string,
): Promise<void> {
  const filePath = resolveFilePath(rootDir, loaderFileName);
  const format = getFileFormat(loaderFileName);
  const { entries, layout } = await readFileCollection(filePath, format);
  if (!(id in entries)) throw new Error(`Entry ${id} not found in ${loaderFileName}`);
  delete entries[id];
  const content = serializeMultiEntryFile(entries, format, layout);
  await writeFile(filePath, content, "utf-8");
}

async function reorderFileEntries(
  rootDir: string,
  ids: string[],
  loaderFileName: string,
): Promise<void> {
  const filePath = resolveFilePath(rootDir, loaderFileName);
  const format = getFileFormat(loaderFileName);
  const { entries, layout } = await readFileCollection(filePath, format);
  const reordered: Record<string, Record<string, unknown>> = {};
  for (const id of ids) {
    if (id in entries) reordered[id] = entries[id];
  }
  // Append any entries not in the provided order (safety net)
  for (const id of Object.keys(entries)) {
    if (!(id in reordered)) reordered[id] = entries[id];
  }
  const content = serializeMultiEntryFile(reordered, format, layout);
  await writeFile(filePath, content, "utf-8");
}

// --- Media helpers ---

async function listMedia(mediaDir: string, extensions: string[]): Promise<MediaFile[]> {
  const formats = extensions.map((e) => e.replace(/^\./, ""));
  const files = await walkDir(mediaDir, formats);
  return Promise.all(
    files.map(async (f) => {
      const fileStat = await stat(join(mediaDir, f.path));
      return {
        path: f.path,
        size: fileStat.size,
        lastModified: fileStat.mtime.toISOString(),
      };
    }),
  );
}

async function writeMedia(
  mediaDir: string,
  filePath: string,
  content: string,
  createDirs: boolean,
): Promise<MediaFile> {
  const fullPath = join(mediaDir, filePath);
  assertWithinBase(fullPath, mediaDir);
  if (createDirs) {
    await mkdir(dirname(fullPath), { recursive: true });
  }
  const buffer = Buffer.from(content, "base64");
  await writeFile(fullPath, buffer);
  const fileStat = await stat(fullPath);
  return {
    path: filePath,
    size: fileStat.size,
    lastModified: fileStat.mtime.toISOString(),
  };
}

async function renameMedia(mediaDir: string, oldPath: string, newPath: string): Promise<MediaFile> {
  const fullOld = join(mediaDir, oldPath);
  const fullNew = join(mediaDir, newPath);
  assertWithinBase(fullOld, mediaDir);
  assertWithinBase(fullNew, mediaDir);
  await mkdir(dirname(fullNew), { recursive: true });
  await rename(fullOld, fullNew);
  const fileStat = await stat(fullNew);
  return {
    path: newPath,
    size: fileStat.size,
    lastModified: fileStat.mtime.toISOString(),
  };
}

async function deleteMedia(mediaDir: string, filePath: string): Promise<void> {
  const fullPath = join(mediaDir, filePath);
  assertWithinBase(fullPath, mediaDir);
  await unlink(fullPath);
}

// --- Middleware ---

function createDevMiddleware(
  server: ViteDevServer,
  options: DevMiddlewareOptions,
  markWrite: () => void,
): (req: IncomingMessage, res: ServerResponse, next: NextFn) => void {
  const {
    basePath,
    contentDir,
    mediaDir,
    mediaPrefix,
    allowedMediaExtensions,
    rootDir,
    collections,
  } = options;

  const apiPrefix = `${basePath}__cms`;

  function isFileCollection(collection: string): boolean {
    return collections?.[collection]?.loaderType === "file";
  }

  function getLoaderFileName(collection: string): string | null {
    return collections?.[collection]?.loaderFileName ?? null;
  }

  return async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith(`${apiPrefix}/`)) {
      next();
      return;
    }

    // CSRF protection: block cross-origin requests
    const origin = req.headers.origin;
    if (origin) {
      const serverUrl = server.resolvedUrls?.local[0];
      if (serverUrl && new URL(origin).origin !== new URL(serverUrl).origin) {
        sendError(res, "Cross-origin request blocked", 403);
        return;
      }
    }

    // A mutating request below writes a file the dev server watches; arm the
    // reload-suppression window now (before that write) so the companion
    // hotUpdate hook drops the full reload it would otherwise trigger, keeping
    // the admin's React state across its own saves.
    if (req.method && MUTATING_METHODS.has(req.method)) markWrite();

    const path = url.slice(apiPrefix.length);

    try {
      // Entry endpoints
      if (path.startsWith("/entries/")) {
        const rest = path.slice("/entries/".length);
        const slashIndex = rest.indexOf("/");
        // The client percent-encodes the entry id (slashes become %2F), so nested
        // ids arrive as a single segment that must be decoded back into a path.
        const collection = decodeURIComponent(slashIndex === -1 ? rest : rest.slice(0, slashIndex));
        const entryId = slashIndex === -1 ? "" : decodeURIComponent(rest.slice(slashIndex + 1));

        const isFile = isFileCollection(collection);
        const loaderFileName = getLoaderFileName(collection);

        if (req.method === "GET" && !entryId) {
          if (isFile && loaderFileName) {
            const entries = await listFileEntries(rootDir, collection, loaderFileName);
            sendJson(res, entries);
          } else {
            const entries = await listGlobEntries(contentDir, collection);
            sendJson(res, entries);
          }
          return;
        }

        if (req.method === "GET" && entryId === "_layout" && isFile && loaderFileName) {
          const filePath = resolveFilePath(rootDir, loaderFileName);
          const fmt = getFileFormat(loaderFileName);
          const { layout } = await readFileCollection(filePath, fmt);
          sendJson(res, { layout });
          return;
        }

        if (req.method === "GET" && entryId) {
          let entry: EntryContent | null;
          if (isFile && loaderFileName) {
            entry = await getFileEntry(rootDir, entryId, loaderFileName);
          } else {
            entry = await getGlobEntry(contentDir, collection, entryId);
          }
          if (!entry) {
            sendError(res, `Entry ${collection}/${entryId} not found`, 404);
            return;
          }
          sendJson(res, entry);
          return;
        }

        if (req.method === "PATCH" && entryId === "_reorder" && isFile && loaderFileName) {
          const body = await readJsonBody<{ ids: string[] }>(req);
          await reorderFileEntries(rootDir, body.ids, loaderFileName);
          sendJson(res, { ok: true });
          return;
        }

        if (req.method === "PUT" && entryId) {
          const body = await readJsonBody<SaveEntryRequest>(req);
          if (isFile && loaderFileName) {
            await saveFileEntry(rootDir, entryId, body.data, loaderFileName);
          } else {
            await saveGlobEntry(contentDir, collection, entryId, body);
          }
          sendJson(res, { ok: true });
          return;
        }

        if (req.method === "DELETE" && entryId) {
          if (isFile && loaderFileName) {
            await deleteFileEntry(rootDir, entryId, loaderFileName);
          } else {
            await deleteGlobEntry(contentDir, collection, entryId);
          }
          sendJson(res, { ok: true });
          return;
        }
      }

      // Media endpoints
      if (path === "/media" && req.method === "GET") {
        const files = await listMedia(mediaDir, allowedMediaExtensions);
        const prefixed = files.map((f) => ({
          ...f,
          path: `${mediaPrefix}/${f.path}`,
        }));
        sendJson(res, prefixed);
        return;
      }

      if (path === "/media" && req.method === "POST") {
        const body = await readJsonBody<{
          path: string;
          content: string;
        }>(req);
        const file = await writeMedia(mediaDir, body.path, body.content, true);
        sendJson(res, { ...file, path: `${mediaPrefix}/${file.path}` }, 201);
        return;
      }

      if (path === "/media" && req.method === "PUT") {
        const body = await readJsonBody<{
          path: string;
          content: string;
        }>(req);
        const file = await writeMedia(mediaDir, body.path, body.content, false);
        sendJson(res, { ...file, path: `${mediaPrefix}/${file.path}` });
        return;
      }

      if (path === "/media" && req.method === "PATCH") {
        const body = await readJsonBody<{
          oldPath: string;
          newPath: string;
        }>(req);
        const file = await renameMedia(mediaDir, body.oldPath, body.newPath);
        sendJson(res, { ...file, path: `${mediaPrefix}/${file.path}` });
        return;
      }

      if (path.startsWith("/media/") && req.method === "DELETE") {
        const mediaPath = decodeURIComponent(path.slice("/media/".length));
        await deleteMedia(mediaDir, mediaPath);
        sendJson(res, { ok: true });
        return;
      }

      sendError(res, "Not found", 404);
    } catch (error) {
      sendError(res, error);
    }
  };
}

// Two cooperating dev plugins that share a suppression window:
//
//   1. The dev API middleware. Registered as a Vite plugin instead of via
//      `astro:server:setup` because Astro unshifts its own trailing-slash
//      middleware to the front of the connect stack from a configureServer
//      post-hook, and under trailingSlash: "always" it rejects our extensionless
//      `/__cms/*` requests with a 404 before an appended middleware would run.
//      `enforce: "post"` makes our post-hook run after Astro's, so the unshift
//      here places the CMS API ahead of that trailing-slash check.
//
//   2. A hotUpdate hook that, for the brief window after a CMS write, drops the
//      content/media module update so Astro's `astro:hmr-reload` plugin (which
//      runs with `order: "post"`) sees no modules and broadcasts no full reload.
//      `order: "pre"` guarantees we run first. Without this, every save would
//      reload the admin and wipe its React state. Manual edits, which arm no
//      window, still reload as usual.
export function cmsDevPlugins(options: DevMiddlewareOptions): Plugin[] {
  const { contentDir, mediaDir } = options;

  let suppressReloadUntil = 0;
  const markWrite = () => {
    suppressReloadUntil = Date.now() + SUPPRESS_WINDOW_MS;
  };

  return [
    {
      name: "astronaut-cms:dev-api",
      enforce: "post",

      configureServer(server) {
        const handle = createDevMiddleware(server, options, markWrite);
        return () => {
          server.middlewares.stack.unshift({ route: "", handle });
        };
      },
    },
    {
      name: "astronaut-cms:suppress-self-reload",

      hotUpdate: {
        order: "pre",
        handler({ file }) {
          if (
            Date.now() < suppressReloadUntil
            && (isWithin(file, contentDir) || isWithin(file, mediaDir))
          ) {
            return [];
          }
        },
      },
    },
  ];
}
