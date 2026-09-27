import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, writeFile, unlink, stat, mkdir, rename } from "node:fs/promises";
import { join, dirname, relative } from "pathe";
import type { Plugin } from "vite";
import type { CollectionManifest, MediaFile } from "../shared/types.ts";
import { readChanges, discardChanges, managedPaths } from "./git-changes.ts";
import { assertWithinBase, isWithin } from "./paths.ts";

type NextFn = () => void;

const MUTATING_METHODS = new Set(["PUT", "POST", "PATCH", "DELETE"]);

const API_PREFIX = "/__cms";

// How long after a CMS write to keep suppressing the dev-server reload it
// triggers. It has to outlast the whole chain — write, content-layer sync, data
// store rewrite, reload broadcast — while staying short enough that a manual
// edit moments later still reloads.
const SUPPRESS_WINDOW_MS = 5000;

export interface DevMiddlewareOptions {
  mediaDir: string;
  rootDir: string;
  collections: CollectionManifest;
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

/** Every file below `dir`, project-relative, with the metadata the media library shows. */
async function listFiles(rootDir: string, dir: string): Promise<MediaFile[]> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = await Promise.all(
    entries.map(async (entry): Promise<MediaFile[]> => {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) return listFiles(rootDir, fullPath);

      const { size, mtime } = await stat(fullPath);

      return [{ path: relative(rootDir, fullPath), size, lastModified: mtime.toISOString() }];
    }),
  );

  return found.flat();
}

/**
 * A file API over the paths the CMS manages, and nothing more. Parsing,
 * serializing and the collection model all live in the browser (see
 * `StorageBase`), so the local backend is composed from the same pieces as the
 * GitHub and GitLab ones instead of from a second implementation here.
 */
function createDevMiddleware(
  options: DevMiddlewareOptions,
  markWrite: () => void,
): (req: IncomingMessage, res: ServerResponse, next: NextFn) => void {
  const { mediaDir, rootDir, collections } = options;

  // The CMS may only read and write inside these, and git may only restore
  // them, so neither can reach the developer's own files.
  const managed = managedPaths({ rootDir, mediaDir, collections });

  // A managed path is a file the CMS owns (a file collection) or anything under
  // a directory it owns. Joining first means a crafted `..` cannot smuggle a
  // path out of the project, and the allowlist bounds it to the content model.
  function resolveManaged(path: string): string {
    const fullPath = join(rootDir, path);
    assertWithinBase(fullPath, rootDir);

    if (!managed.some((root) => isWithin(fullPath, join(rootDir, root)))) {
      throw new Error(`Path is not managed by the CMS: ${path}`);
    }

    return fullPath;
  }

  return async (req, res, next) => {
    const url = req.url ?? "";

    if (!url.startsWith(`${API_PREFIX}/`)) {
      next();
      return;
    }

    const host = req.headers.host;
    const origin = req.headers.origin;
    const mutating = MUTATING_METHODS.has(req.method ?? "");

    // Vite's own host validation runs before this middleware and rejects the
    // rebound hostname a DNS-rebinding page would arrive under, so the only
    // check left to make here is the one Vite has no equivalent of: CSRF.
    // Comparing against the Host header rather than a resolved server URL keeps
    // it correct however the server is bound, `--host` on a LAN address
    // included.
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`) {
      sendError(res, "Cross-origin request blocked", 403);
      return;
    }

    // Browsers always send an Origin on a mutating request, so a missing one
    // never comes from the admin talking to its own dev server.
    if (!origin && mutating) {
      sendError(res, "Missing origin", 403);
      return;
    }

    // A mutating request below writes a file the dev server watches; arm the
    // reload-suppression window now, before that write, so the reload it would
    // trigger is dropped and the admin keeps its state across its own saves.
    if (mutating) markWrite();

    const [path, query] = url.slice(API_PREFIX.length).split("?");

    try {
      if (path === "/files" && req.method === "GET") {
        const dir = new URLSearchParams(query).get("dir") ?? "";

        sendJson(res, await listFiles(rootDir, resolveManaged(dir)));
        return;
      }

      if (path.startsWith("/files/")) {
        const filePath = resolveManaged(decodeURIComponent(path.slice("/files/".length)));

        if (req.method === "GET") {
          try {
            sendJson(res, { content: await readFile(filePath, "utf-8") });
          } catch {
            sendError(res, `File not found: ${relative(rootDir, filePath)}`, 404);
          }

          return;
        }

        if (req.method === "PUT") {
          const { content, encoding } = await readJsonBody<{
            content: string;
            encoding?: "base64";
          }>(req);

          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, encoding === "base64" ? Buffer.from(content, "base64") : content);
          sendJson(res, { ok: true });
          return;
        }

        // A move needs a second path, so it carries a body instead of encoding
        // both in the URL.
        if (req.method === "PATCH") {
          const { to } = await readJsonBody<{ to: string }>(req);
          const target = resolveManaged(to);

          await mkdir(dirname(target), { recursive: true });
          await rename(filePath, target);
          sendJson(res, { ok: true });
          return;
        }

        if (req.method === "DELETE") {
          await unlink(filePath);
          sendJson(res, { ok: true });
          return;
        }
      }

      // Local storage has no draft branch, so everything pending is what git
      // reports for the managed paths, and discarding is restoring them.
      if (path === "/changes" && req.method === "GET") {
        sendJson(res, await readChanges(rootDir, managed));
        return;
      }

      if (path === "/changes" && req.method === "DELETE") {
        await discardChanges(rootDir, managed);
        sendJson(res, { ok: true });
        return;
      }

      sendError(res, "Not found", 404);
    } catch (error) {
      sendError(res, error);
    }
  };
}

/**
 * Drops full-reload broadcasts on one environment while `isSuppressed()` holds,
 * and leaves every other message alone.
 *
 * A reload is announced from more places than a single hook can see: Astro's
 * `astro:hmr-reload` plugin, its `invalidateDataStore` (which fires when the
 * content layer rewrites `.astro/data-store.json`, not from a `hotUpdate` at
 * all), and any other plugin watching the files the CMS writes. Intercepting
 * the message they all end in covers them together, and keeps the module
 * invalidation each of them does on the way.
 */
function suppressReloads(
  channel: { send: (...args: never[]) => void },
  isSuppressed: () => boolean,
): void {
  const send = channel.send.bind(channel);

  channel.send = (...args: never[]) => {
    const payload: unknown = args[0];
    const isFullReload =
      typeof payload === "object" && (payload as { type?: string } | null)?.type === "full-reload";

    if (isFullReload && isSuppressed()) return;

    send(...args);
  };
}

// One plugin, two jobs sharing a suppression window:
//
//   1. The dev API middleware, appended from the configureServer body. That
//      position matters in both directions: Vite registers its host-validation
//      and CORS middlewares before any plugin hook runs, so appending leaves
//      the CMS API behind them and DNS-rebinding protection applies to it for
//      free; and Astro registers everything of its own (including the catch-all
//      dev handler) from a post-hook, which all run after every body, so the
//      CMS API is still reached first.
//
//      The API lives at the origin root rather than under `base`, so its path
//      always starts with `/_` — a prefix Astro classifies as internal and
//      passes through its trailing-slash and prerender middlewares untouched.
//      Prefixing with `base` instead would 404 under trailingSlash: "always".
//
//   2. Reload suppression for the window a CMS write opens. Without it every
//      save reloads the admin and wipes its state, the open assistant
//      conversation included. Manual edits arm no window and still reload.
//
// Every environment is patched, not just the client. Vite announces reloads per
// environment, and the SSR one is a module runner: a `full-reload` there makes
// it drop its evaluated modules and re-import its entrypoints, which fails on
// Astro's own `astro:server-app.js` and leaves the dev server unable to render.
export function cmsDevPlugin(options: DevMiddlewareOptions): Plugin {
  let suppressReloadUntil = 0;
  const markWrite = () => {
    suppressReloadUntil = Date.now() + SUPPRESS_WINDOW_MS;
  };

  return {
    name: "astronaut-cms:dev-api",
    enforce: "post",

    configureServer(server) {
      server.middlewares.use(createDevMiddleware(options, markWrite));

      for (const environment of Object.values(server.environments)) {
        suppressReloads(environment.hot, () => Date.now() < suppressReloadUntil);
      }
    },
  };
}
