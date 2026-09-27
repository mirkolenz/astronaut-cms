import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";
import type { Plugin } from "vite";
import type { CmsClientConfig, CmsConfig } from "./types.ts";
import { CLIENT_REDIRECTS } from "./client-redirects.ts";

const DEFAULT_CLIENT_STUBS = ["@astrojs/starlight/loaders"];
const STUB_PREFIX = "virtual:cms-stub/";

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
    if (conditions.source) {
      const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
      map[specifier] = resolve(root, conditions.source);
    }
  }
  return map;
}

export function cmsVitePlugin(
  config: CmsConfig,
  userConfigPath: string | null,
  contentConfigPath: string | null,
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

  const configFiles = new Set<string>();
  if (contentConfigPath) configFiles.add(contentConfigPath);
  if (userConfigPath) configFiles.add(userConfigPath);
  const stubs = config.clientStubs ?? [...DEFAULT_CLIENT_STUBS];
  const stubExports = new Map<string, string[]>();

  const virtualModules: Record<string, string> = {
    "virtual:astronaut-cms/config": `export default ${JSON.stringify(clientConfig)};`,
    "virtual:astronaut-cms/user-config": generateUserConfigModule(userConfigPath),
    "virtual:astronaut-cms/collections": generateCollectionsModule(contentConfigPath),
    "virtual:astronaut-cms/assets": generateAssetsModule(clientConfig.mediaDirectory),
  };

  return {
    name: "astronaut-cms:virtual-modules",
    enforce: "pre",

    async buildStart() {
      if (stubExports.size > 0) return;
      await init;
      const req = createRequire(contentConfigPath ?? import.meta.url);
      for (const mod of stubs) {
        try {
          const names = parse(readFileSync(req.resolve(mod), "utf-8"))[1]
            .map((e) => e.n)
            .filter((n) => n !== "default");
          if (names.length > 0) stubExports.set(mod, names);
        } catch {
          // Module not installed — skip.
        }
      }
    },

    config: () => ({
      optimizeDeps: {
        exclude: [...stubs, ...Object.keys(CLIENT_REDIRECTS)],
      },
    }),

    resolveId(id) {
      if (id in virtualModules || id.startsWith(STUB_PREFIX))
        return "\0" + id;
      // Resolve astronaut-cms exports to source files when available
      // (workspace-linked development). Checked before the client-only
      // gate so it applies in all Vite environments (SSR + client).
      if (id in SOURCE_EXPORTS) {
        const sourcePath = SOURCE_EXPORTS[id];
        if (existsSync(sourcePath)) return sourcePath;
      }
      if (this.environment?.name !== "client") return;
      if (id in CLIENT_REDIRECTS) return this.resolve(CLIENT_REDIRECTS[id]);
      if (stubExports.has(id)) return "\0" + STUB_PREFIX + id;
    },

    load(id) {
      if (!id.startsWith("\0")) return;
      const vid = id.slice(1);
      if (vid in virtualModules) return virtualModules[vid];
      if (vid.startsWith(STUB_PREFIX)) {
        return (stubExports.get(vid.slice(STUB_PREFIX.length)) ?? [])
          .map((n) => `export const ${n} = () => ({});`)
          .join("\n");
      }
    },

    // In client builds, rewrite import specifiers in config files so that
    // Node.js-only modules are replaced before Vite resolves them.
    transform(code, id) {
      if (!configFiles.has(id)) return;
      if (this.environment?.name !== "client") return;

      const [imports] = parse(code);
      let result = code;
      let offset = 0;

      for (const imp of imports) {
        if (!imp.n) continue;
        const replacement =
          CLIENT_REDIRECTS[imp.n] ??
          (stubExports.has(imp.n) ? STUB_PREFIX + imp.n : undefined);
        if (!replacement) continue;

        result =
          result.slice(0, imp.s + offset) +
          replacement +
          result.slice(imp.e + offset);
        offset += replacement.length - (imp.e - imp.s);
      }

      if (result !== code) return result;
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

function generateCollectionsModule(configPath: string | null): string {
  if (!configPath) return "export default {};";
  return `\
import { collections } from "${configPath}";
import { processCollections } from "astronaut-cms/stubs";
export default processCollections(collections);`;
}

// Emits the lazy `import.meta.glob` maps that back `astronaut-cms/assets`. Only
// the globs live here because Vite's import.meta.glob requires a static literal
// argument with the media directory baked in; the resolver logic that consumes
// these maps is plain (type-checked) TypeScript in src/runtime/assets.ts. Lazy
// globs keep the Promise-based form expected by astro:assets <Image>, and `import:
// "default"` makes each loader resolve straight to the ImageMetadata / URL. This
// runs entirely in Vite, independent of the markdown processor (unified or satteri).
function generateAssetsModule(mediaDirectory: string): string {
  // posix.join normalizes any leading/trailing slashes into a single root-absolute base.
  const base = posix.join("/", mediaDirectory);
  const imagesGlob = JSON.stringify(`${base}/**/*.{png,jpg,jpeg,webp,avif,gif,svg,tiff}`);
  const filesGlob = JSON.stringify(`${base}/**/*`);
  return `\
export const images = import.meta.glob(${imagesGlob}, { import: "default" });
export const files = import.meta.glob(${filesGlob}, { query: "?url", import: "default" });`;
}

function generateUserConfigModule(configPath: string | null): string {
  const configImport = configPath
    ? `import { components as rawComponents } from "${configPath}";`
    : "const rawComponents = undefined;";
  return `\
${configImport}
import { processUserConfig } from "astronaut-cms/stubs";
const components = processUserConfig(rawComponents);
export { components };`;
}
