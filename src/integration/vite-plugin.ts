import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "pathe";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { CmsClientConfig, CmsConfig } from "./types.ts";
import type { CollectionManifest } from "../shared/types.ts";
import { ASTRO_IMAGE_FORMATS } from "../shared/image-formats.ts";

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

export function cmsVitePlugin(
  config: CmsConfig,
  userConfigPath: string | null,
  collections: CollectionManifest | null,
): Plugin {
  const storage = config.storage ?? { type: "local" as const };
  const clientConfig: CmsClientConfig = {
    mountPoint: config.mountPoint ?? "/admin",
    storageType: storage.type,
    mediaDirectory: config.media?.directory ?? "src/assets",
    locale: config.locale ?? "en",
    previewUrl: config.previewUrl,
    ...(storage.type === "github" && {
      github: {
        repo: storage.repo,
        branch: storage.branch ?? "main",
        clientId: storage.clientId,
        publishMode: storage.publishMode ?? "direct",
      },
    }),
    ...(storage.type === "gitlab" && {
      gitlab: {
        project: storage.project,
        branch: storage.branch ?? "main",
        clientId: storage.clientId,
        instanceUrl: storage.instanceUrl ?? "https://gitlab.com",
        publishMode: storage.publishMode ?? "direct",
      },
    }),
  };

  const virtualModules: Record<string, string> = {
    "virtual:astronaut-cms/config": `export default ${JSON.stringify(clientConfig)};`,
    "virtual:astronaut-cms/collections": `export default ${JSON.stringify(collections ?? {})};`,
    "virtual:astronaut-cms/user-config": generateUserConfigModule(userConfigPath),
    "virtual:astronaut-cms/assets": generateAssetsModule(clientConfig.mediaDirectory),
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

// Emits the lazy `import.meta.glob` maps that back `astronaut-cms/assets`. Only
// the globs live here because Vite's import.meta.glob requires a static literal
// argument with the media directory baked in; the resolver logic that consumes
// these maps is plain (type-checked) TypeScript in src/runtime/assets.ts. Lazy
// globs keep the Promise-based form expected by astro:assets <Image>, and `import:
// "default"` makes each loader resolve straight to the ImageMetadata / URL.
function generateAssetsModule(mediaDirectory: string): string {
  // join normalizes any leading/trailing slashes into a single root-absolute base.
  const base = join("/", mediaDirectory);
  const imagesGlob = JSON.stringify(`${base}/**/*.{${ASTRO_IMAGE_FORMATS.join(",")}}`);
  const filesGlob = JSON.stringify(`${base}/**/*`);
  return `\
export const images = import.meta.glob(${imagesGlob}, { import: "default" });
export const files = import.meta.glob(${filesGlob}, { query: "?url", import: "default" });`;
}

function generateUserConfigModule(configPath: string | null): string {
  if (!configPath) return "export const components = {};";
  return `\
import { components as rawComponents } from ${JSON.stringify(configPath)};
import { processUserConfig } from "astronaut-cms/internal";
export const components = processUserConfig(rawComponents);`;
}
