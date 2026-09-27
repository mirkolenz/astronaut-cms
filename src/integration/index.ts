import type { AstroIntegration } from "astro";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import type { CmsConfig } from "./types.ts";
import { cmsVitePlugin } from "./vite-plugin.ts";
import { createDevMiddleware } from "./dev-middleware.ts";
import { createJiti } from "jiti";
import { CLIENT_REDIRECTS } from "./client-redirects.ts";
import { remarkCmsAssets, type AssetFieldsMap } from "./remark-cms-assets.ts";
import { unified, isUnifiedProcessor } from "@astrojs/markdown-remark";
import { getAssetType } from "../shared/schema-utils.ts";

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

interface LoadedComponentDef {
  props?: { shape?: Record<string, Parameters<typeof getAssetType>[0]> };
  children?: "markdown" | Record<string, LoadedComponentDef>;
}

function flattenAssetFields(defs: Record<string, LoadedComponentDef>, result: AssetFieldsMap) {
  for (const [name, def] of Object.entries(defs)) {
    const shape = def.props?.shape;
    if (shape) {
      const fields: Record<string, "image" | "file"> = {};
      for (const [propName, propSchema] of Object.entries(shape)) {
        const assetType = getAssetType(propSchema);
        if (assetType) fields[propName] = assetType;
      }
      if (Object.keys(fields).length > 0) result[name] = fields;
    }
    if (typeof def.children === "object" && def.children !== null) {
      flattenAssetFields(def.children, result);
    }
  }
}

function createCmsJiti(rootDir: string) {
  return createJiti(rootDir, { alias: CLIENT_REDIRECTS });
}

function extractAssetFields(userConfigPath: string, rootDir: string): AssetFieldsMap {
  const jiti = createCmsJiti(rootDir);
  const { components } = jiti(userConfigPath) as {
    components?: Record<string, LoadedComponentDef>;
  };

  const result: AssetFieldsMap = {};
  flattenAssetFields(components ?? {}, result);
  return result;
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

        // Extract asset fields from CMS config for remark plugin
        let assetFieldsMap: AssetFieldsMap = {};
        if (userConfigPath) {
          try {
            assetFieldsMap = extractAssetFields(userConfigPath, rootDir);
            if (Object.keys(assetFieldsMap).length > 0) {
              logger.info(`Extracted asset fields: ${JSON.stringify(assetFieldsMap)}`);
            }
          } catch (err) {
            logger.warn(
              `Could not extract asset fields from CMS config: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Astro 6.4+ sources Markdown/MDX plugins from `markdown.processor`; the
        // top-level `markdown.remarkPlugins` option is deprecated and is ignored by
        // @astrojs/mdx v6. Attach to the unified processor (creating it if unset).
        // Sätteri and other non-unified processors don't run remark plugins, and
        // their plugin API can't inject the module-level imports this plugin relies
        // on, so asset auto-import is only available under unified().
        const processor = astroConfig.markdown.processor;
        if (processor && !isUnifiedProcessor(processor)) {
          logger.warn(
            `Markdown processor "${processor.name}" does not run remark plugins, so CMS asset `
              + `auto-import (component image()/file() props and relative asset links) is disabled. `
              + `Markdown images still resolve via the processor's built-in handling. `
              + `Set markdown.processor: unified({...}) to enable full CMS asset handling.`,
          );
        } else {
          const target = processor ?? unified();
          target.options.remarkPlugins.push([remarkCmsAssets, assetFieldsMap]);
          updateConfig({ markdown: { processor: target } });
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
