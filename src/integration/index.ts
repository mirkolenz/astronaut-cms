import type { AstroIntegration } from "astro";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "pathe";
import tailwindcss from "@tailwindcss/vite";
import type { CmsConfig } from "./types.ts";
import { cmsVitePlugin } from "./vite-plugin.ts";
import { createDevMiddleware } from "./dev-middleware.ts";
import { createJiti } from "jiti";
import { CLIENT_REDIRECTS } from "./client-redirects.ts";

export type { CmsConfig, StorageConfig, MediaConfig, SupportedLocale } from "./types.ts";
export { defineComponent, image, file } from "../config.ts";
export type {
  ComponentDefinition,
  InferComponentProps,
  ChildrenConfig,
} from "../config.ts";

const CONFIG_EXTENSIONS = ["ts", "mts", "js", "mjs"];

const DEFAULT_MEDIA_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".svg",
  ".gif",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip",
  ".csv",
];

function findConfig(rootDir: string, base: string): string | null {
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = join(rootDir, `${base}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function createCmsJiti(rootDir: string) {
  return createJiti(rootDir, { alias: CLIENT_REDIRECTS });
}

interface LoadedCollectionMeta {
  loaderType: "glob" | "file";
  loaderFileName?: string | null;
  loaderBase?: string | null;
}

function extractCollectionMeta(
  contentConfigPath: string,
  rootDir: string,
): Record<string, LoadedCollectionMeta> | null {
  try {
    const jiti = createCmsJiti(rootDir);
    const mod = jiti(contentConfigPath) as {
      collections?: Record<
        string,
        {
          loader?: {
            __cmsFileName?: string | null;
            __cmsBase?: string | null;
          };
        }
      >;
    };
    const collections = mod.collections ?? {};
    const result: Record<string, LoadedCollectionMeta> = {};
    for (const [name, col] of Object.entries(collections)) {
      result[name] = {
        loaderType: col.loader?.__cmsFileName != null ? "file" : "glob",
        loaderFileName: col.loader?.__cmsFileName ?? null,
        loaderBase: col.loader?.__cmsBase ?? null,
      };
    }
    return result;
  } catch {
    return null;
  }
}

export default function cms(config: CmsConfig = {}): AstroIntegration {
  const mountPoint = config.mountPoint ?? "/admin";
  let contentDir = "";
  let mediaDir = "";
  let rootDir = "";
  let basePath = "/";
  let collectionsMeta: Record<string, LoadedCollectionMeta> | null = null;

  return {
    name: "astronaut-cms",
    hooks: {
      "astro:config:setup": ({
        config: astroConfig,
        command,
        injectRoute,
        updateConfig,
        logger,
      }) => {
        rootDir = fileURLToPath(astroConfig.root);
        basePath = astroConfig.base;
        contentDir = join(rootDir, "src/content");
        mediaDir = join(rootDir, config.media?.directory ?? "src/assets");

        const overrideToLocal =
          command === "dev"
          && (config.localStorageInDev ?? true)
          && (config.storage?.type ?? "local") !== "local";
        const effectiveConfig: CmsConfig = overrideToLocal
          ? { ...config, storage: { type: "local" } }
          : config;
        if (overrideToLocal) {
          logger.info(
            `Using local storage for "astro dev" (configured "${config.storage?.type}" backend will be used in build)`,
          );
        }

        // Validate the effective storage so the dev override skips OAuth-credential checks.
        const storage = effectiveConfig.storage;
        if (storage) {
          if (storage.type === "github") {
            if (!storage.repo)
              throw new Error("GitHub storage: 'repo' is required (e.g., 'owner/repo').");
            if (!storage.clientId)
              throw new Error("GitHub storage: 'clientId' is required for OAuth.");
          } else if (storage.type === "gitlab") {
            if (!storage.project)
              throw new Error("GitLab storage: 'project' is required (e.g., 'group/project').");
            if (!storage.clientId)
              throw new Error("GitLab storage: 'clientId' is required for OAuth.");
          }
        }

        // Resolve CMS config path
        let userConfigPath: string | null = null;
        if (config.config) {
          userConfigPath = join(rootDir, config.config);
          if (!existsSync(userConfigPath)) {
            throw new Error(
              `CMS config file not found at "${userConfigPath}" (specified as "${config.config}")`,
            );
          }
          logger.info(`Using CMS config at ${userConfigPath}`);
        } else {
          userConfigPath = findConfig(rootDir, "src/cms.config");
          if (userConfigPath) {
            logger.info(`Found CMS config at ${userConfigPath}`);
          } else {
            logger.info("No cms.config found — using defaults");
          }
        }

        // Auto-discover content.config.{ts,mts,js,mjs}
        const contentConfigPath = findConfig(rootDir, "src/content.config");
        if (contentConfigPath) {
          logger.info(`Found content config at ${contentConfigPath}`);
          collectionsMeta = extractCollectionMeta(contentConfigPath, rootDir);
        } else {
          logger.warn("No content.config found — collections will be empty");
        }

        updateConfig({
          vite: {
            plugins: [
              tailwindcss(),
              cmsVitePlugin(effectiveConfig, userConfigPath, contentConfigPath),
            ],
          },
        });

        if (command === "dev" || effectiveConfig.storage?.type !== "local") {
          injectRoute({
            pattern: mountPoint,
            entrypoint: "astronaut-cms/admin.astro",
          });
          logger.info(`Admin panel will be available at ${mountPoint}`);
        } else {
          logger.info(
            `Admin panel disabled for "${command}" with local storage (only available via "astro dev")`,
          );
        }
      },

      "astro:server:setup": ({ server }) => {
        server.middlewares.use(
          createDevMiddleware(server, {
            basePath,
            contentDir,
            mediaDir,
            mediaPrefix: config.media?.directory ?? "src/assets",
            allowedMediaExtensions: config.media?.allowedExtensions ?? DEFAULT_MEDIA_EXTENSIONS,
            rootDir,
            collections: collectionsMeta ?? undefined,
          }),
        );
      },
    },
  };
}
