import type { Plugin } from "vite";
import type { CmsConfig } from "./types.ts";

const ASTRO_IMPORT_RE = /from\s+["'](?:astro:content|astro\/loaders|astro\/zod)["']/;

export function cmsVitePlugin(
  config: CmsConfig,
  userConfigPath: string | null,
  contentConfigPath: string | null,
): Plugin {
  const storage = config.storage ?? { type: "local" as const };

  const clientConfig: Record<string, unknown> = {
    mountPoint: config.mountPoint ?? "/admin",
    storageType: storage.type,
    mediaDirectory: config.media?.directory ?? "src/assets",
    locale: config.locale ?? "en",
  };

  if (storage.type === "github") {
    clientConfig.github = {
      repo: storage.repo,
      branch: storage.branch ?? "main",
      clientId: storage.clientId,
    };
  } else if (storage.type === "gitlab") {
    clientConfig.gitlab = {
      project: storage.project,
      branch: storage.branch ?? "main",
      clientId: storage.clientId,
      instanceUrl: storage.instanceUrl ?? "https://gitlab.com",
    };
  }

  const modules: Record<string, () => string> = {
    "virtual:astronaut-cms/config": () => `export default ${JSON.stringify(clientConfig)};`,
    "virtual:astronaut-cms/user-config": () => generateUserConfigModule(userConfigPath),
    "virtual:astronaut-cms/collections": () => generateCollectionsModule(contentConfigPath),
  };

  const configFiles = new Set(
    [contentConfigPath, userConfigPath].filter((p): p is string => p != null),
  );

  return {
    name: "astronaut-cms:virtual-modules",
    resolveId(id) {
      if (id in modules) return "\0" + id;
      if (id === "astro/loaders" || id === "astro:content")
        return this.resolve("astronaut-cms/stubs");
      if (id === "astro/zod") return this.resolve("zod/v4");
    },
    load(id) {
      if (!id.startsWith("\0")) return;
      const virtualId = id.slice(1);
      if (virtualId in modules) return modules[virtualId]();
    },
    // In client builds, Astro's content plugin blocks astro:content imports
    // with a "server-only module" error. Replace these imports with CMS stubs
    // at the source level so they never reach Astro's resolveId/load hooks.
    // The environment guard is needed so the SSR build keeps using real Astro modules.
    transform(code, id) {
      if (!configFiles.has(id)) return;
      if (this.environment?.name !== "client") return;
      if (!ASTRO_IMPORT_RE.test(code)) return;

      return code
        .replace(/from\s+["']astro:content["']/g, 'from "astronaut-cms/stubs"')
        .replace(/from\s+["']astro\/loaders["']/g, 'from "astronaut-cms/stubs"')
        .replace(/from\s+["']astro\/zod["']/g, 'from "zod/v4"');
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

function generateCollectionsModule(contentConfigPath: string | null): string {
  if (!contentConfigPath) {
    return `export default {};`;
  }

  const importPath = contentConfigPath.replace(/\\/g, "/");

  return `
import { collections as _raw } from "${importPath}";
import { processCollections } from "astronaut-cms/stubs";
export default processCollections(_raw);
`;
}

function generateUserConfigModule(userConfigPath: string | null): string {
  const importProcessor = `import { processUserConfig } from "astronaut-cms/stubs";`;

  if (!userConfigPath) {
    return `
${importProcessor}
const { components, remarkPlugins, rehypePlugins } = processUserConfig(null);
export { components, remarkPlugins, rehypePlugins };
`;
  }

  const importPath = userConfigPath.replace(/\\/g, "/");

  return `
import _config from "${importPath}";
${importProcessor}
const { components, remarkPlugins, rehypePlugins } = processUserConfig(_config);
export { components, remarkPlugins, rehypePlugins };
`;
}
