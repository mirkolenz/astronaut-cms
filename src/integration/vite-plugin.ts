import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "pathe";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { HookParameters } from "astro";
import type { AiGateway, CmsClientConfig } from "./types.ts";
import type { CollectionManifest } from "../shared/types.ts";
import { ASTRO_IMAGE_FORMATS } from "../shared/image-formats.ts";
import { collectReferencedAssets } from "./collect-assets.ts";

type AstroCommand = HookParameters<"astro:config:setup">["command"];

// Derive source paths from package.json exports for workspace-linked dev.
// For published packages the source files don't exist and the existsSync
// guard in resolveId falls through to default (dist/) resolution.
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PKG_JSON_PATH = resolve(PKG_ROOT, "package.json");
const SOURCE_EXPORTS: Record<string, string> = existsSync(PKG_JSON_PATH)
  ? buildSourceExports(PKG_ROOT, PKG_JSON_PATH)
  : {};

function buildSourceExports(root: string, pkgPath: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    name: string;
    exports?: Record<string, { source?: string }>;
  };
  const map: Record<string, string> = {};
  for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
    // Existence is fixed for the process (workspace-linked source vs published
    // dist), so resolve it once here and keep `resolveId` a pure lookup.
    const sourcePath = conditions.source && resolve(root, conditions.source);
    if (sourcePath && existsSync(sourcePath)) {
      const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
      map[specifier] = sourcePath;
    }
  }
  return map;
}

export interface CmsVitePluginOptions {
  clientConfig: CmsClientConfig;
  aiGateway: AiGateway | null;
  userConfigPath: string | null;
  collections: CollectionManifest;
  command: AstroCommand;
  rootDir: string;
  /** Media-directory-relative globs to bundle even when no content references them. */
  alwaysInclude: string[];
}

export function cmsVitePlugin(options: CmsVitePluginOptions): Plugin {
  const { clientConfig, aiGateway, userConfigPath, collections } = options;

  const virtualModules: Record<string, string> = {
    "virtual:astronaut-cms/config": `export default ${JSON.stringify(clientConfig)};`,
    "virtual:astronaut-cms/ai-server": `export default ${JSON.stringify(aiGateway)};`,
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

// Emits the lazy loader maps that back `astronaut-cms/assets`, keyed by
// root-absolute path. Lazy loaders keep the Promise-based form expected by
// astro:assets <Image>, resolving straight to the ImageMetadata / URL.
//
// A build emits one entry per asset content actually references (see
// collect-assets.ts), because a glob is a static set of dynamic imports and so
// makes Rollup emit the whole media directory. The two maps are collected
// separately rather than sliced by extension: a `?url` entry keeps an image's
// full-size original alive, which is pure waste for one only ever rendered.
// Dev keeps the glob, so a file uploaded through the media library resolves
// without restarting the server.
function generateAssetsModule(options: CmsVitePluginOptions): string {
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

  const { images, files } = collectReferencedAssets({
    rootDir: options.rootDir,
    mediaDirectory: options.clientConfig.mediaDirectory,
    collections: options.collections,
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
