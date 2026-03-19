import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, writeFile, unlink, stat, mkdir, rename } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import {
  ALL_FORMATS,
  type EntryMeta,
  type EntryContent,
  type MediaFile,
  type SaveEntryRequest,
} from "@/shared/types.ts";
import {
  parseContent,
  serializeContent,
  parseMultiEntryFile,
  serializeMultiEntryFile,
  getFileExtension,
} from "@/shared/content-parser.ts";
import { validateSegment, validatePath, validateFormat } from "@/shared/validation.ts";

type NextFn = () => void;

export interface DevMiddlewareOptions {
  contentDir: string;
  mediaDir: string;
  mediaPrefix: string;
  allowedMediaExtensions: string[];
  rootDir: string;
  collections?: Record<
    string,
    {
      loaderType: "glob" | "file";
      loaderFileName?: string | null;
      loaderBase?: string | null;
    }
  >;
}

function assertWithinBase(filePath: string, baseDir: string): void {
  const resolved = resolve(filePath);
  const resolvedBase = resolve(baseDir);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + "/")) {
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
  await mkdir(join(contentDir, collection), { recursive: true });
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

export function createDevMiddleware(
  server: ViteDevServer,
  options: DevMiddlewareOptions,
): (req: IncomingMessage, res: ServerResponse, next: NextFn) => void {
  const { contentDir, mediaDir, mediaPrefix, allowedMediaExtensions, rootDir, collections } =
    options;

  function isFileCollection(collection: string): boolean {
    return collections?.[collection]?.loaderType === "file";
  }

  function getLoaderFileName(collection: string): string | null {
    return collections?.[collection]?.loaderFileName ?? null;
  }

  return async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/__cms/")) {
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

    const path = url.slice("/__cms".length);

    try {
      // Entry endpoints
      if (path.startsWith("/entries/")) {
        const rest = path.slice("/entries/".length);
        const slashIndex = rest.indexOf("/");
        const collection = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
        const entryId = slashIndex === -1 ? "" : rest.slice(slashIndex + 1);

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

      // Publish endpoint (batch write for deferred saves)
      if (path === "/publish" && req.method === "POST") {
        const body = await readJsonBody<{
          changes: Array<{
            collection: string;
            entryId: string;
            action: "create" | "update" | "delete";
            content?: string;
            format: string;
          }>;
        }>(req);

        // Temporarily stop watching content dir so writes don't trigger
        // Astro's content layer watcher and cause a full page reload
        server.watcher.unwatch(contentDir);

        try {
          // Group file collection changes by collection to batch writes
          const fileCollectionChanges: Record<
            string,
            Array<(typeof body.changes)[number]>
          > = {};

          for (const change of body.changes) {
            validateSegment(change.collection, "collection");
            validatePath(change.entryId, "entryId");
            validateFormat(change.format);

            const loaderFileName = getLoaderFileName(change.collection);

            if (isFileCollection(change.collection) && loaderFileName) {
              if (!fileCollectionChanges[change.collection]) {
                fileCollectionChanges[change.collection] = [];
              }
              fileCollectionChanges[change.collection].push(change);
            } else {
              // Glob collection: per-file writes
              if (change.action === "delete") {
                await deleteGlobEntry(contentDir, change.collection, change.entryId);
              } else {
                const filePath = join(
                  contentDir,
                  change.collection,
                  `${change.entryId}.${change.format}`,
                );
                assertWithinBase(filePath, contentDir);
                await mkdir(join(contentDir, change.collection), {
                  recursive: true,
                });
                await writeFile(filePath, change.content ?? "", "utf-8");
              }
            }
          }

          // Apply batched file collection changes
          for (const [collection, changes] of Object.entries(fileCollectionChanges)) {
            const loaderFileName = getLoaderFileName(collection)!;
            const filePath = resolveFilePath(rootDir, loaderFileName);
            const format = getFileFormat(loaderFileName);
            const { entries, layout } = await readFileCollection(filePath, format);

            for (const change of changes) {
              if (change.action === "delete") {
                delete entries[change.entryId];
              } else if (change.content) {
                const { data } = parseContent(change.content, change.format);
                entries[change.entryId] = data;
              }
            }

            const content = serializeMultiEntryFile(entries, format, layout);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, content, "utf-8");
          }
        } finally {
          // Resume watching after writes have settled
          setTimeout(() => server.watcher.add(contentDir), 500);
        }

        sendJson(res, { ok: true });
        return;
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
