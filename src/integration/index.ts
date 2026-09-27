import type { AstroIntegration } from "astro";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "pathe";
import tailwindcss from "@tailwindcss/vite";
import type { CmsConfig } from "./types.ts";
import type { CollectionManifest } from "../shared/types.ts";
import { AI_CHAT_COMPLETIONS_PATTERN } from "../shared/ai.ts";
import { AUTH_TOKEN_PATTERN, GITHUB_CLIENT_SECRET_ENV } from "../shared/auth.ts";
import { MEDIA_API_BASE, S3_ACCESS_KEY_ID_ENV } from "../shared/media.ts";
import { cmsVitePlugin } from "./vite-plugin.ts";
import { cmsDevPlugin } from "./dev-middleware.ts";
import { loadCollections } from "./load-config.ts";
import {
  githubAuthMode,
  resolveAiServer,
  resolveAlwaysInclude,
  resolveClientConfig,
  resolveMediaServer,
} from "./resolve-config.ts";

export type {
  CmsConfig,
  StorageConfig,
  MediaConfig,
  MediaBackendConfig,
  S3MediaConfig,
  R2MediaConfig,
  SupportedLocale,
} from "./types.ts";
export type { ContentI18n } from "../shared/i18n.ts";
export { defineComponent, file } from "../config.ts";
export type {
  ComponentDefinition,
  InferComponentProps,
  ChildrenConfig,
  SchemaHelpers,
} from "../config.ts";

const CONFIG_EXTENSIONS = ["ts", "mts", "js", "mjs"];

function findConfig(rootDir: string, base: string): string | null {
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = join(rootDir, `${base}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Astro only optimizes a remote image whose host it was told to trust, and the
 * site already named that host as `publicUrl`, so it is authorized here rather
 * than asked for again in `image.remotePatterns`.
 */
function mediaRemotePattern(publicUrl: string) {
  const url = new URL(publicUrl);
  const pathname = url.pathname.replace(/\/+$/, "");

  return {
    protocol: url.protocol.replace(":", ""),
    hostname: url.hostname,
    ...(pathname && { pathname: `${pathname}/**` }),
  };
}

/** The SDK is an optional peer dependency, so name its absence here rather than as a failed import. */
function assertS3SdkInstalled(rootDir: string): void {
  const require = createRequire(join(rootDir, "package.json"));

  for (const pkg of ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]) {
    try {
      require.resolve(pkg);
    } catch {
      throw new Error(
        `Media backend: "${pkg}" is not installed. Reaching an object store over the S3 API needs it: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`,
      );
    }
  }
}

/**
 * Uploaded files are attacker-influenced bytes the site serves back, and some of
 * the library's default types (SVG) are documents a browser will run. Serving
 * them from the admin's own origin would make every upload a candidate for
 * same-origin script in the CMS, so the two origins have to differ.
 *
 * Only checkable when the site declares its own URL; `site` is optional in Astro,
 * so this is enforced where it is knowable and documented where it is not.
 */
function validateMediaOrigin(publicUrl: string, site: string | undefined): void {
  const siteOrigin = site && new URL(site).origin;

  if (!siteOrigin || new URL(publicUrl).origin !== siteOrigin) return;

  throw new Error(
    `media: 'publicUrl' (${publicUrl}) must not share an origin with the site itself (${siteOrigin}). Uploaded files would be same-origin content in the admin; serve the library from its own host, e.g. a separate CDN subdomain.`,
  );
}

/** Everything an object-store media backend has to declare before it can be reached. */
function validateMediaBackend(config: CmsConfig, site: string | undefined): void {
  const backend = config.media?.backend;

  if (!backend || backend.type === "repo") return;

  if (!backend.bucket) throw new Error(`${backend.type} media: 'bucket' is required.`);

  if (!backend.publicUrl) {
    throw new Error(
      `${backend.type} media: 'publicUrl' is required — it is the base the library is publicly served under, and what content references resolve against.`,
    );
  }

  validateMediaOrigin(backend.publicUrl, site);

  if (backend.type === "s3" && !backend.endpoint) {
    throw new Error(
      "s3 media: 'endpoint' is required (e.g. 'https://s3.eu-central-1.amazonaws.com').",
    );
  }

  if (backend.type === "r2" && !backend.accountId && !backend.binding) {
    throw new Error("r2 media: either 'accountId' (S3 API) or 'binding' (Workers) is required.");
  }
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

        // `astro dev` edits the working tree rather than the configured backends, so
        // running the admin needs neither OAuth credentials nor the production bucket.
        const storageType = config.storage?.type ?? "local";
        const backendType = config.media?.backend?.type ?? "repo";
        const devStorage =
          command === "dev" && (config.localStorageInDev ?? true) && storageType !== "local";
        // The working-tree library is reached through the dev file API, so it only
        // exists where content is edited locally too. Only the bytes move: the
        // reference format stays the store's, so an entry edited in dev builds
        // unchanged (which the repository substitution this replaced did not).
        const wantsLocalMedia =
          command === "dev" && (config.localMediaInDev ?? true) && backendType !== "repo";
        const localMedia = wantsLocalMedia && (devStorage || storageType === "local");

        const effectiveConfig: CmsConfig = {
          ...config,
          ...(devStorage && { storage: { type: "local" as const } }),
        };

        if (devStorage) {
          logger.info(
            `Using local storage for "astro dev" (configured "${config.storage?.type}" backend will be used in build)`,
          );
        }

        if (wantsLocalMedia) {
          logger.info(
            localMedia
              ? `Media library served from the working tree for "astro dev" (the configured "${backendType}" store is used in build; references keep its key format either way)`
              : `Editing the configured "${backendType}" media store in "astro dev": localMediaInDev needs local storage, and this run uses "${storageType}". Uploads and deletions here reach the bucket the deployed site serves.`,
          );
        }

        // Before anything reads the backend: resolving it assumes a complete one,
        // and a `publicUrl` that is missing rather than wrong would otherwise
        // surface as a TypeError from deep inside the resolver.
        validateMediaBackend(effectiveConfig, astroConfig.site);

        // Every default is applied once, here; `clientConfig` is what the admin
        // bundle and the rest of this hook both read.
        const clientConfig = resolveClientConfig(
          effectiveConfig,
          astroConfig.trailingSlash,
          astroConfig.i18n,
          localMedia,
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

            // Which kind of app issued the browser's token decides what it is
            // worth, and the default changed to the narrower one, so it is
            // stated rather than left to be discovered at the sign-in prompt.
            logger.info(
              `GitHub sign-in uses authMode "${githubAuthMode(storage)}" (a GitHub App issues repository-limited, expiring tokens; set authMode: "oauth-app" if you registered a classic OAuth App)`,
            );
          } else if (storage.type === "gitlab") {
            if (!storage.project)
              throw new Error("GitLab storage: 'project' is required (e.g., 'group/project').");
            if (!storage.clientId)
              throw new Error("GitLab storage: 'clientId' is required for OAuth.");
          }
        }

        // Nothing reaches the store while the library is the working tree, so the
        // route that would hold its credential is never injected.
        const mediaServer = localMedia ? null : resolveMediaServer(effectiveConfig);

        // A Workers binding never loads the SDK, so only the S3 path demands it.
        if (mediaServer?.s3) assertS3SdkInstalled(rootDir);

        if (mediaServer && effectiveConfig.media?.alwaysInclude?.length) {
          logger.warn(
            "media.alwaysInclude is ignored for an object-store backend: its files are served from the store, never bundled.",
          );
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
          ...(clientConfig.mediaBackend.type === "remote" && {
            image: { remotePatterns: [mediaRemotePattern(clientConfig.mediaBackend.publicUrl)] },
          }),
          vite: {
            plugins: [
              tailwindcss(),
              cmsVitePlugin({
                clientConfig,
                aiServer: resolveAiServer(effectiveConfig),
                mediaServer,
                userConfigPath,
                collections,
                command,
                rootDir,
                logger,
                alwaysInclude: resolveAlwaysInclude(effectiveConfig),
              }),
              // Dev-only filesystem API for the local storage backend, plus the
              // reload suppression that keeps the admin's state across its own saves.
              ...(command === "dev" ? [cmsDevPlugin({ mediaDir, rootDir, collections })] : []),
            ],
          },
        });

        // The admin (and therefore the AI relay it calls) is only reachable via
        // `astro dev` when storage is local; a remote backend keeps it in the
        // production build too.
        const adminAvailable = command === "dev" || effectiveConfig.storage?.type !== "local";

        // Whether this deployment can render on demand. The admin's security
        // headers — `frame-ancestors` above all, which a meta policy cannot carry
        // — only exist on a rendered response, so the page is served that way
        // wherever it is possible at no cost. An adapter settles it; the feature
        // list covers the case where one is registered by a later integration and
        // is therefore not yet visible here, but already implies an adapter
        // because each of these injects an on-demand route of its own.
        const serverRendered =
          Boolean(astroConfig.adapter) ||
          Boolean(mediaServer) ||
          Boolean(effectiveConfig.ai?.enabled) ||
          clientConfig.github?.flow === "redirect";

        if (adminAvailable) {
          injectRoute({
            pattern: mountPoint,
            entrypoint: "astronaut-cms/admin.astro",
            ...(serverRendered && { prerender: false }),
          });
          logger.info(
            serverRendered
              ? `Admin panel will be available at ${mountPoint} (rendered on demand, with security headers)`
              : `Admin panel will be available at ${mountPoint} (prerendered: set Content-Security-Policy, X-Frame-Options, Referrer-Policy and X-Content-Type-Options for it at your host)`,
          );
        } else {
          logger.info(
            `Admin panel disabled for "${command}" with local storage (only available via "astro dev")`,
          );
        }

        /**
         * A server route the admin calls. Injected only where the admin exists,
         * so a static local-storage build (which has no adapter) is not forced
         * on-demand — and reported the same way for every route.
         */
        const injectServerRoute = (
          pattern: string,
          entrypoint: string,
          label: string,
          detail = "",
        ) => {
          if (adminAvailable) {
            injectRoute({ pattern, entrypoint, prerender: false });
            logger.info(`${label} will be available at ${pattern}${detail}`);
          } else {
            logger.info(
              `${label} disabled for "${command}" with local storage (only available via "astro dev")`,
            );
          }
        };

        // The redirect flow redeems its code through a server route (see `src/auth/handler.ts`).
        if (clientConfig.github?.flow === "redirect") {
          injectServerRoute(
            AUTH_TOKEN_PATTERN,
            "astronaut-cms/auth-endpoint",
            "GitHub token exchange",
            ` (set ${GITHUB_CLIENT_SECRET_ENV} on the server)`,
          );
        }

        // The store credential lives here, so the route exists only where the admin does.
        if (mediaServer) {
          injectServerRoute(
            MEDIA_API_BASE,
            "astronaut-cms/media-endpoint",
            "Media backend",
            mediaServer.binding
              ? ` (R2 binding "${mediaServer.binding}")`
              : ` (set ${S3_ACCESS_KEY_ID_ENV} and its secret on the server)`,
          );
        }

        if (config.ai?.enabled) {
          if (!config.ai.models?.length) {
            throw new Error("AI assistant: 'models' must list at least one gateway model id.");
          }

          if (!config.ai.gateway) {
            throw new Error("AI assistant: 'gateway' is required (e.g. { type: \"netlify\" }).");
          }

          injectServerRoute(
            AI_CHAT_COMPLETIONS_PATTERN,
            "astronaut-cms/ai-endpoint",
            "AI assistant relay",
          );
        }
      },
    },
  };
}
