import { existsSync, readFileSync } from "node:fs";
import { join } from "pathe";
import type { Plugin } from "vite";
import type { HookParameters } from "astro";
import type { CmsClientConfig, CmsRuntime, CmsServerConfig } from "./types.ts";
import type { CollectionManifest, CollectionSort } from "../shared/types.ts";
import { getFileExtension, parseMultiEntryFile } from "../shared/content-parser.ts";
import { ASTRO_IMAGE_FORMATS } from "../shared/image-formats.ts";
import { collectReferencedAssets } from "./collect-assets.ts";
import type { ContentEntry } from "./content-files.ts";
import { SOURCE_EXPORTS } from "./self-resolve.ts";
import { DEV_API_ENVIRONMENT } from "./dev-api.ts";

type AstroCommand = HookParameters<"astro:config:setup">["command"];

export interface CmsVitePluginOptions {
  clientConfig: CmsClientConfig;
  /** Everything only the injected route may see: credentials’ identity, bucket, gateway. */
  serverConfig: CmsServerConfig;
  userConfigPath: string | null;
  collections: CollectionManifest;
  /** The entries on disk, read once by the integration for every build-time pass. */
  entries: ContentEntry[];
  command: AstroCommand;
  rootDir: string;
  /** Media-directory-relative globs to bundle even when no content references them. */
  alwaysInclude: string[];
  /** The host site's Astro `base`, which the admin needs to address the API. */
  base: string;
  /** Where the injected routes read secrets and bindings from. */
  runtime: CmsRuntime;
}

/** What a module generated per load is told: whether it runs in the dev API, and how to watch a file. */
interface LoadContext {
  devApi: boolean;
  watch: (path: string) => void;
}

export function cmsVitePlugin(options: CmsVitePluginOptions): Plugin {
  const { clientConfig, serverConfig, userConfigPath, collections } = options;

  const virtualModules: Record<string, string | ((ctx: LoadContext) => string)> = {
    "virtual:astronaut-cms/config": `export default ${JSON.stringify(clientConfig)};`,
    // Split out of the config so the admin can address the API before it has
    // one. The config is delivered by the session probe and therefore only to a
    // recognised editor, but a request has to be made to reach the probe at all,
    // and these two are what makes that request land on the injected route. They
    // are the site's own public URL shape, so bundling them gives nothing away.
    "virtual:astronaut-cms/routing": `export default ${JSON.stringify({
      base: options.base,
      trailingSlash: clientConfig.trailingSlash,
    })};`,
    "virtual:astronaut-cms/server": `export default ${JSON.stringify(serverConfig)};`,
    // Workers hand the environment to a module rather than to a global, and the
    // import only resolves inside a Workers build, so which of these is emitted
    // is settled here, where the target runtime is known. The dev API runs in
    // Node whatever the adapter.
    "virtual:astronaut-cms/runtime-env": ({ devApi }) =>
      options.runtime === "cloudflare" && !devApi
        ? `export { env as default } from "cloudflare:workers";`
        : `export default undefined;`,
    // The filesystem backend is Node-only, so it is linked in exactly where it
    // runs, the dev API, and stubbed everywhere else: without this, `node:fs`
    // would follow the injected route into a Workers or edge bundle.
    "virtual:astronaut-cms/local-storage": ({ devApi }) =>
      serverConfig.storage.type === "local" && devApi
        ? `export { LocalStorage } from "astronaut-cms/server-local";`
        : `export const LocalStorage = null;`,
    // The AWS SDK is an optional peer, so only a site reaching its library
    // through S3 links it, and fails against the stub Vite substitutes for a
    // peer that is not installed otherwise. The import stays lazy, so a cold
    // start that never touches media never loads the SDK.
    "virtual:astronaut-cms/s3-store":
      serverConfig.media?.access.type === "s3"
        ? `export const loadS3Store = () => import("astronaut-cms/server-s3").then((m) => m.S3Store);`
        : `export const loadS3Store = null;`,
    "virtual:astronaut-cms/order": ({ watch }) =>
      generateOrderModule(collections, options.rootDir, watch),
    "virtual:astronaut-cms/collections": `export default ${JSON.stringify(collections)};`,
    "virtual:astronaut-cms/user-config": generateUserConfigModule(userConfigPath),
    "virtual:astronaut-cms/assets": generateAssetsModule(options),
  };

  return {
    name: "astronaut-cms:virtual-modules",
    enforce: "pre",

    resolveId(id) {
      if (id in virtualModules) return "\0" + id;
      // Resolve astronaut-cms exports to source files when available
      // (workspace-linked development), so the admin can use the TypeScript
      // sources directly without a rebuilt dist.
      if (id in SOURCE_EXPORTS) return SOURCE_EXPORTS[id];
    },

    load(id) {
      const module = id.startsWith("\0") ? virtualModules[id.slice(1)] : undefined;

      if (typeof module !== "function") return module;

      return module({
        devApi: this.environment.name === DEV_API_ENVIRONMENT,
        watch: (path) => this.addWatchFile(path),
      });
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes("dev-toolbar") && req.url.endsWith(".map")) {
          res.setHeader("Content-Type", "application/json");
          res.end('{"version":3,"sources":[],"mappings":""}');
          return;
        }
        next();
      });
    },
  };
}

// Emits the lazy loader maps that back `astronaut-cms/assets`, keyed by
// root-absolute path. Lazy loaders keep the Promise-based form expected by
// astro:assets <Image>, resolving straight to the ImageMetadata / URL. A file is
// never inlined as a data URL, which would lose its name as a download and its
// caching as a video.
//
// A build emits one entry per asset content actually references (see
// collect-assets.ts), because a glob is a static set of dynamic imports and so
// makes Rollup emit the whole media directory. Which map an asset lands in comes
// from the schema that declared it, not from its extension: a `?url` entry keeps
// an image's full-size original alive, which is pure waste for one only ever
// rendered. Dev keeps the glob, so a file uploaded through the media library
// resolves without restarting the server, and the extension list is all it has
// to go on.
function generateAssetsModule(options: CmsVitePluginOptions): string {
  const { mediaBackend } = options.clientConfig;

  // A library outside the repository has nothing to bundle: its files are never
  // in the project, so the resolver builds a URL under the public base instead
  // of importing anything, and astro treats the result as a remote image. Unless
  // this dev run stands in for the store with the working tree, where the maps
  // are exactly what a repository library gets.
  if (mediaBackend.type === "remote" && !mediaBackend.local) {
    return `\
export const referencedOnly = false;
export const images = {};
export const files = {};`;
  }

  // join normalizes any leading/trailing slashes into a single root-absolute base.
  const base = join("/", options.clientConfig.mediaDirectory);

  if (options.command !== "build") {
    // The glob argument has to be a static literal, which is why these live here
    // rather than in the (type-checked) resolver in src/assets/index.ts.
    const imagesGlob = JSON.stringify(`${base}/**/*.{${ASTRO_IMAGE_FORMATS.join(",")}}`);
    const filesGlob = JSON.stringify(`${base}/**/*`);

    return `\
export const referencedOnly = false;
export const images = import.meta.glob(${imagesGlob}, { import: "default" });
export const files = import.meta.glob(${filesGlob}, { query: "?url&no-inline", import: "default" });`;
  }

  const { images, files } = collectReferencedAssets({
    rootDir: options.rootDir,
    mediaDirectory: options.clientConfig.mediaDirectory,
    entries: options.entries,
    alwaysInclude: options.alwaysInclude,
  });

  return `\
export const referencedOnly = true;
export const images = ${loaderMap(images, "")};
export const files = ${loaderMap(files, "?url&no-inline")};`;
}

function loaderMap(keys: string[], query: string): string {
  if (keys.length === 0) return "{}";

  const entries = keys.map(
    (key) =>
      `  ${JSON.stringify(key)}: () => import(${JSON.stringify(key + query)}).then((m) => m.default),`,
  );

  return `{\n${entries.join("\n")}\n}`;
}

// The order behind `sortEntries`. File order is read off the file on every load
// and the file is watched, so an edit reaches the site without a restart.
function generateOrderModule(
  collections: CollectionManifest,
  rootDir: string,
  watch: (path: string) => void,
): string {
  const sorts: Record<string, CollectionSort> = {};
  const fileOrder: Record<string, string[]> = {};

  for (const { name, sort, loaderFileName } of Object.values(collections)) {
    if (sort !== "id") sorts[name] = sort;

    // A file sort is only accepted on a file() collection, which names its file.
    if (sort !== "file" || !loaderFileName) continue;

    const path = join(rootDir, loaderFileName);

    watch(path);

    fileOrder[name] = existsSync(path)
      ? [...parseMultiEntryFile(readFileSync(path, "utf-8"), getFileExtension(path)).entries.keys()]
      : [];
  }

  return `\
export const sorts = ${JSON.stringify(sorts)};
export const fileOrder = ${JSON.stringify(fileOrder)};`;
}

function generateUserConfigModule(configPath: string | null): string {
  if (!configPath) return "export const components = {};";
  return `\
import { components as rawComponents } from ${JSON.stringify(configPath)};
import { processUserConfig } from "astronaut-cms/internal";
export const components = processUserConfig(rawComponents);`;
}
