import type { AstroIntegration } from "astro";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "pathe";
import tailwindcss from "@tailwindcss/vite";
import type { CmsConfig } from "./types.ts";
import type { CollectionManifest } from "../shared/types.ts";
import { AI_CHAT_COMPLETIONS_PATTERN } from "../shared/ai.ts";
import { cmsVitePlugin } from "./vite-plugin.ts";
import { cmsDevPlugin } from "./dev-middleware.ts";
import { loadCollections } from "./load-collections.ts";
import { resolveAiGateway, resolveClientConfig } from "./resolve-config.ts";

export type { CmsConfig, StorageConfig, MediaConfig, SupportedLocale } from "./types.ts";
export type { ContentI18n } from "../shared/i18n.ts";
export { defineComponent, image, file } from "../config.ts";
export type { ComponentDefinition, InferComponentProps, ChildrenConfig } from "../config.ts";

const CONFIG_EXTENSIONS = ["ts", "mts", "js", "mjs"];

function findConfig(rootDir: string, base: string): string | null {
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = join(rootDir, `${base}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export default function cms(config: CmsConfig = {}): AstroIntegration {
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
        const rootDir = fileURLToPath(astroConfig.root);

        const overrideToLocal =
          command === "dev" &&
          (config.localStorageInDev ?? true) &&
          (config.storage?.type ?? "local") !== "local";
        const effectiveConfig: CmsConfig = overrideToLocal
          ? { ...config, storage: { type: "local" } }
          : config;
        if (overrideToLocal) {
          logger.info(
            `Using local storage for "astro dev" (configured "${config.storage?.type}" backend will be used in build)`,
          );
        }

        // Every default is applied once, here; `clientConfig` is what the admin
        // bundle and the rest of this hook both read.
        const clientConfig = resolveClientConfig(
          effectiveConfig,
          astroConfig.trailingSlash,
          astroConfig.i18n,
        );
        const mountPoint = clientConfig.mountPoint;
        const mediaDir = join(rootDir, clientConfig.mediaDirectory);

        if (clientConfig.contentI18n) {
          const { locales, defaultLocale } = clientConfig.contentI18n;
          logger.info(
            `Multilingual content enabled for locales ${locales.join(", ")} (default: ${defaultLocale})`,
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

        // Auto-discover and load content.config.{ts,mts,js,mjs}
        const contentConfigPath = findConfig(rootDir, "src/content.config");
        let collections: CollectionManifest = {};
        if (contentConfigPath) {
          logger.info(`Found content config at ${contentConfigPath}`);
          collections = loadCollections(contentConfigPath, rootDir, logger);
        } else {
          logger.warn("No content.config found — collections will be empty");
        }

        updateConfig({
          vite: {
            plugins: [
              tailwindcss(),
              cmsVitePlugin({
                clientConfig,
                aiGateway: resolveAiGateway(effectiveConfig),
                userConfigPath,
                collections,
              }),
              // Dev-only filesystem API for the local storage backend, plus the
              // reload suppression that keeps the admin's state across its own saves.
              ...(command === "dev"
                ? [cmsDevPlugin({ mediaDir, rootDir, collections })]
                : []),
            ],
          },
        });

        // The admin (and therefore the AI relay it calls) is only reachable via
        // `astro dev` when storage is local; a remote backend keeps it in the
        // production build too.
        const adminAvailable = command === "dev" || effectiveConfig.storage?.type !== "local";

        if (adminAvailable) {
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

        if (config.ai?.enabled) {
          if (!config.ai.models?.length) {
            throw new Error("AI assistant: 'models' must list at least one gateway model id.");
          }

          if (!config.ai.gateway) {
            throw new Error("AI assistant: 'gateway' is required (e.g. { type: \"netlify\" }).");
          }

          // The relay is a server route. Inject it only where the admin exists,
          // so a static local-storage build (no adapter) is not forced on-demand.
          if (adminAvailable) {
            injectRoute({
              pattern: AI_CHAT_COMPLETIONS_PATTERN,
              entrypoint: "astronaut-cms/ai-endpoint",
              prerender: false,
            });
            logger.info(`AI assistant relay will be available at ${AI_CHAT_COMPLETIONS_PATTERN}`);
          } else {
            logger.info(
              `AI assistant relay disabled for "${command}" with local storage (only available via "astro dev")`,
            );
          }
        }
      },
    },
  };
}
