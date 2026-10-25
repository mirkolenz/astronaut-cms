/**
 * What `astro dev` adds to the dev server: reload suppression, and for local
 * storage the CMS API itself (see `dev-api.ts`).
 *
 * The admin writes files the dev server watches, so without this every save
 * reloads the page and wipes its state, the open assistant conversation
 * included. The CMS's own writes arm a short window in which a full reload is
 * dropped; a manual edit arms none and still reloads.
 */
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { API_BASE } from "../shared/auth.ts";
import { WRITE_HEADER } from "../shared/http.ts";
import { DEV_API_ENVIRONMENT, devApiEnvironment, serveDevApi } from "./dev-api.ts";

// How long after a CMS write to keep suppressing the dev-server reload it
// triggers. It has to outlast the whole chain of write, content-layer sync,
// data store rewrite and reload broadcast, while staying short enough that a
// manual edit moments later still reloads.
const SUPPRESS_WINDOW_MS = 5000;

/**
 * Requests that write, and therefore arm the window.
 *
 * Every CMS operation is a POST, so the method says nothing; the admin marks the
 * ones that change content (see `WRITE_HEADER`), and an upload is a write by its
 * path alone.
 */
function isWrite(req: IncomingMessage): boolean {
  return req.headers[WRITE_HEADER] != null || req.url?.includes(`${API_BASE}/upload`) === true;
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

/**
 * Every environment is patched, not just the client. Vite announces reloads per
 * environment, and the SSR one is a module runner: a `full-reload` there makes
 * it drop its evaluated modules and re-import its entrypoints, which fails on
 * Astro's own `astro:server-app.js` and leaves the dev server unable to render.
 *
 * `apiPath` is where the dev server answers the API itself, or null when the
 * adapter's route does.
 */
export function cmsDevPlugin(apiPath: string | null): Plugin {
  let suppressReloadUntil = 0;

  return {
    name: "astronaut-cms:dev",
    enforce: "post",

    config: () =>
      apiPath ? { environments: { [DEV_API_ENVIRONMENT]: devApiEnvironment } } : undefined,

    configureServer(server) {
      // Appended from the body so it runs before Astro's own catch-all handler
      // (registered from a post-hook) and therefore sees the CMS write before
      // the file watcher does.
      server.middlewares.use((req, res, next) => {
        const arm = () => (suppressReloadUntil = Date.now() + SUPPRESS_WINDOW_MS);

        // Armed again once the write is answered, so one that outlasts the
        // window, such as a large upload, still has its reload dropped.
        if (isWrite(req)) {
          arm();
          res.once("close", arm);
        }

        next();
      });

      // After the window is armed, since the API answers without passing the request on.
      if (apiPath) serveDevApi(server, apiPath);

      for (const environment of Object.values(server.environments)) {
        suppressReloads(environment.hot, () => Date.now() < suppressReloadUntil);
      }
    },
  };
}
