import { join } from "pathe";
import type { Plugin } from "vite";
import type { HookParameters } from "astro";
import type { CmsClientConfig, CmsServerConfig } from "./types.ts";
import type { CollectionManifest } from "../shared/types.ts";
import { ASTRO_IMAGE_FORMATS } from "../shared/image-formats.ts";
import { collectReferencedAssets } from "./collect-assets.ts";
import { loadComponents, type ConfigLogger } from "./load-config.ts";
import { SOURCE_EXPORTS } from "./self-resolve.ts";

type AstroCommand = HookParameters<"astro:config:setup">["command"];

export interface CmsVitePluginOptions {
  clientConfig: CmsClientConfig;
  /** Everything only the injected route may see: credentials’ identity, bucket, gateway. */
  serverConfig: CmsServerConfig;
  userConfigPath: string | null;
  collections: CollectionManifest;
  command: AstroCommand;
  rootDir: string;
  logger: ConfigLogger;
  /** Media-directory-relative globs to bundle even when no content references them. */
  alwaysInclude: string[];
}

export function cmsVitePlugin(options: CmsVitePluginOptions): Plugin {
  const { clientConfig, serverConfig, userConfigPath, collections } = options;

  const virtualModules: Record<string, string> = {
    "virtual:astronaut-cms/config": `export default ${JSON.stringify(clientConfig)};`,
    "virtual:astronaut-cms/server": `export default ${JSON.stringify(serverConfig)};`,
    // The filesystem backend is Node-only, so it is linked in exactly where it
    // can run and stubbed everywhere else: without this, `node:fs` would follow
    // the injected route into a Workers or edge bundle and fail it outright.
    "virtual:astronaut-cms/local-storage":
      serverConfig.storage.type === "local"
        ? `export { LocalStorage } from "astronaut-cms/server-local";`
        : `export const LocalStorage = null;`,
    "virtual:astronaut-cms/collections": `export default ${JSON.stringify(collections)};`,
    "virtual:astronaut-cms/user-config": generateUserConfigModule(userConfigPath),
    "virtual:astronaut-cms/assets": generateAssetsModule(options),
    "virtual:astronaut-cms/media-source": generateMediaSourceModule(options),
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
      if (id.startsWith("\0")) {
        const vid = id.slice(1);
        if (vid in virtualModules) return virtualModules[vid];
      }
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

/**
 * How the site turns a library key into a URL it can load, for the one backend
 * where that is not a lookup.
 *
 * A public library needs nothing at runtime, so the module is a constant the
 * resolver never calls. A private one has to sign, which means the AWS SDK and
 * the bucket credentials — linked in here alone, so a public library and a
 * repository library carry neither.
 */
function generateMediaSourceModule(options: CmsVitePluginOptions): string {
  const { mediaBackend } = options.clientConfig;

  if (mediaBackend.type !== "remote" || mediaBackend.local || mediaBackend.publicUrl) {
    return "export const mediaSourceUrl = null;";
  }

  return `export { presignedMediaUrl as mediaSourceUrl } from "astronaut-cms/media-presign";`;
}

// Emits the lazy loader maps that back `astronaut-cms/assets`, keyed by
// root-absolute path. Lazy loaders keep the Promise-based form expected by
// astro:assets <Image>, resolving straight to the ImageMetadata / URL.
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
export const files = import.meta.glob(${filesGlob}, { query: "?url", import: "default" });`;
  }

  // The component prop schemas are read here rather than handed in, so the one
  // place that decides a build needs them is the one place that asks for them.
  const components = options.userConfigPath
    ? loadComponents(options.userConfigPath, options.rootDir, options.logger)
    : {};

  const { images, files } = collectReferencedAssets({
    rootDir: options.rootDir,
    mediaDirectory: options.clientConfig.mediaDirectory,
    collections: options.collections,
    components,
    alwaysInclude: options.alwaysInclude,
  });

  return `\
export const referencedOnly = true;
export const images = ${loaderMap(images, "")};
export const files = ${loaderMap(files, "?url")};`;
}

function loaderMap(keys: string[], query: string): string {
  if (keys.length === 0) return "{}";

  const entries = keys.map(
    (key) =>
      `  ${JSON.stringify(key)}: () => import(${JSON.stringify(key + query)}).then((m) => m.default),`,
  );

  return `{\n${entries.join("\n")}\n}`;
}

function generateUserConfigModule(configPath: string | null): string {
  if (!configPath) return "export const components = {};";
  return `\
import { components as rawComponents } from ${JSON.stringify(configPath)};
import { processUserConfig } from "astronaut-cms/internal";
export const components = processUserConfig(rawComponents);`;
}
