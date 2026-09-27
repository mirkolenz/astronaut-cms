import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { init, parse } from "es-module-lexer";
import type { Plugin } from "vite";
import type { CmsClientConfig, CmsConfig } from "./types.ts";
import { CLIENT_REDIRECTS } from "./client-redirects.ts";

const DEFAULT_CLIENT_STUBS = ["@astrojs/starlight/loaders"];
const STUB_PREFIX = "virtual:cms-stub/";

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
    ...(storage.type === "github" && {
      github: {
        repo: storage.repo,
        branch: storage.branch ?? "main",
        clientId: storage.clientId,
      },
    }),
    ...(storage.type === "gitlab" && {
      gitlab: {
        project: storage.project,
        branch: storage.branch ?? "main",
        clientId: storage.clientId,
        instanceUrl: storage.instanceUrl ?? "https://gitlab.com",
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

function generateUserConfigModule(configPath: string | null): string {
  const configImport = configPath
    ? `import config from "${configPath}";`
    : "const config = null;";
  return `\
${configImport}
import { processUserConfig } from "astronaut-cms/stubs";
const { components } = processUserConfig(config);
export { components };`;
}
