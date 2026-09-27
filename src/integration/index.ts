import type { AstroIntegration } from "astro";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "pathe";
import tailwindcss from "@tailwindcss/vite";
import type { CmsConfig } from "./types.ts";
import { API_PATTERN, GITHUB_CLIENT_SECRET_ENV, GITLAB_CLIENT_SECRET_ENV } from "../shared/auth.ts";
import { S3_ACCESS_KEY_ID_ENV } from "../shared/media.ts";
import { cmsVitePlugin } from "./vite-plugin.ts";
import { routeEntrypoint } from "./self-resolve.ts";
import { cmsDevPlugin } from "./dev-middleware.ts";
import { loadConfigs } from "./load-config.ts";
import { checkContent } from "./check-content.ts";
import { contentEntries } from "./content-files.ts";
import { unexposable } from "../shared/tools/exposable.ts";
import {
  isByok,
  resolveAlwaysInclude,
  resolveClientConfig,
  resolveCollections,
  resolveMediaServer,
  resolveServerConfig,
  storageType,
} from "./resolve-config.ts";
import { isAddressable } from "../shared/ai.ts";

export type {
  CmsConfig,
  CollectionOptions,
  CollectionSort,
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
      `${backend.type} media: 'publicUrl' is required, the base the library's keys are served under (e.g. 'https://cdn.example.com').`,
    );
  }

  validateMediaOrigin(backend.publicUrl, site);

  if (backend.type === "s3" && !backend.endpoint) {
    throw new Error(
      "s3 media: 'endpoint' is required (e.g. 'https://s3.eu-central-1.amazonaws.com').",
    );
  }

  if (backend.type === "r2" && !backend.accountId === !backend.binding) {
    throw new Error("r2 media: set exactly one of 'accountId' (S3 API) or 'binding' (Workers).");
  }
}

/** The one adapter that provides a Workers runtime, as Astro names it. */
const CLOUDFLARE_ADAPTER = "@astrojs/cloudflare";

export default function cms(config: CmsConfig = {}): AstroIntegration {
  return {
    name: "astronaut-cms",
    hooks: {
      "astro:config:setup": async ({
        config: astroConfig,
        command,
        injectRoute,
        updateConfig,
        logger,
      }) => {
        const rootDir = fileURLToPath(astroConfig.root);

        // `astro dev` edits the working tree rather than the configured backends, so
        // running the admin needs neither OAuth credentials nor the production bucket.
        const configuredStorage = storageType(config);
        const backendType = config.media?.backend?.type ?? "repo";
        const devStorage =
          command === "dev" && (config.localStorageInDev ?? true) && configuredStorage !== "local";
        // The working-tree library is reached through the dev file API, so it only
        // exists where content is edited locally too. Only the bytes move: the
        // reference format stays the store's, so an entry edited in dev builds
        // unchanged (which the repository substitution this replaced did not).
        const wantsLocalMedia =
          command === "dev" && (config.localMediaInDev ?? true) && backendType !== "repo";
        const localMedia = wantsLocalMedia && (devStorage || configuredStorage === "local");

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
              : `Editing the configured "${backendType}" media store in "astro dev": localMediaInDev needs local storage, and this run uses "${configuredStorage}". Uploads and deletions here reach the bucket the deployed site serves.`,
          );
        }

        // Before anything reads the backend: resolving it assumes a complete one,
        // and a field that is missing rather than wrong would otherwise surface
        // as a TypeError from deep inside the resolver.
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

        if (clientConfig.contentI18n) {
          const { locales, defaultLocale } = clientConfig.contentI18n;
          logger.info(
            `Multilingual content enabled for locales ${locales.join(", ")} (default: ${defaultLocale})`,
          );
        }

        // Validate the effective storage so the dev override skips OAuth-credential checks.
        const storage = effectiveConfig.storage;

        if (storage?.type === "github") {
          if (!storage.repo)
            throw new Error("GitHub storage: 'repo' is required (e.g., 'owner/repo').");
          if (!storage.clientId)
            throw new Error("GitHub storage: 'clientId' is the GitHub App's client id.");
        } else if (storage?.type === "gitlab") {
          if (!storage.project)
            throw new Error("GitLab storage: 'project' is required (e.g., 'group/project').");
          if (!storage.clientId)
            throw new Error("GitLab storage: 'clientId' is required for OAuth.");
        }

        // Nothing reaches the store while the library is the working tree, so the
        // route that would hold its credential is never injected.
        const mediaServer = localMedia ? null : resolveMediaServer(effectiveConfig);

        // A Workers binding never loads the SDK, so only the S3 path demands it.
        if (mediaServer?.access.type === "s3") assertS3SdkInstalled(rootDir);

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

        if (contentConfigPath) {
          logger.info(`Found content config at ${contentConfigPath}`);
        } else {
          logger.warn("No content.config found — collections will be empty");
        }

        // Read once for every pass over content: the check below and, in a build,
        // the assets it bundles.
        const loaded = await loadConfigs(rootDir, {
          content: contentConfigPath,
          cms: userConfigPath,
        });
        const { components } = loaded;
        const collections = resolveCollections(loaded.collections, effectiveConfig);
        const entries =
          command === "build" || command === "dev"
            ? contentEntries(rootDir, collections, components)
            : [];

        // Content the admin would refuse to save fails a build, where whoever
        // committed it sees it, rather than surfacing later at an editor's save.
        const problems = checkContent(entries);

        if (problems.length > 0) {
          const report = `Content the CMS cannot save:\n${problems.map((p) => `- ${p}`).join("\n")}`;

          if (command === "build") throw new Error(`astronaut-cms: ${report}`);

          logger.warn(report);
        }

        // Only worth saying where something would read it. The tools a
        // collection gets are named after it, and both an AI gateway and
        // `registerTool` refuse a name outside their alphabet — a gateway by
        // rejecting the whole request, so one bad collection would otherwise
        // take the assistant down with a message nobody can act on.
        if (effectiveConfig.ai?.enabled || effectiveConfig.webmcp?.enabled) {
          for (const [name, col] of Object.entries(collections)) {
            const reason = unexposable(name, col);

            if (reason) {
              logger.warn(
                `Collection "${name}" cannot be edited by the assistant or a browser agent, and is left out of their tools (reading it still works): ${reason}`,
              );
            }
          }
        }

        const serverConfig = resolveServerConfig(effectiveConfig, rootDir, mediaServer);

        // Where runtime bindings and secrets come from. Astro has no capability
        // to ask, so the adapter's own name is the signal; `runtime` overrides it
        // for an adapter that wraps or forks one of these under another name.
        const runtime =
          effectiveConfig.runtime ??
          (astroConfig.adapter?.name === CLOUDFLARE_ADAPTER ? "cloudflare" : "node");

        // A binding only exists inside a Workers runtime. Left to itself the
        // reader would answer `undefined` for it and the failure would surface
        // much later as "no binding configured", so a misdetected adapter is
        // called out here instead.
        const access = serverConfig.media?.access;

        if (access?.type === "binding" && runtime !== "cloudflare") {
          throw new Error(
            `Media binding '${access.name}' needs a Cloudflare Workers runtime, but the adapter is ${astroConfig.adapter?.name ?? "unset"}. Set 'runtime: "cloudflare"' if it deploys to Workers under another name, or configure 'accountId' to reach the bucket over the S3 API instead.`,
          );
        }

        const { mediaBackend } = clientConfig;

        updateConfig({
          ...(mediaBackend.type === "remote" && {
            image: { remotePatterns: [mediaRemotePattern(mediaBackend.publicUrl)] },
          }),
          vite: {
            plugins: [
              tailwindcss(),
              cmsVitePlugin({
                clientConfig,
                serverConfig,
                userConfigPath,
                collections,
                entries,
                command,
                rootDir,
                alwaysInclude: resolveAlwaysInclude(effectiveConfig),
                base: astroConfig.base,
                runtime,
              }),
              // The admin writes files the dev server watches; without this every
              // save reloads the page and wipes its state.
              ...(command === "dev" ? [cmsDevPlugin()] : []),
            ],
          },
        });

        // The admin is only reachable via `astro dev` when storage is local; a
        // remote backend keeps it in the production build too.
        const adminAvailable = command === "dev" || storageType(effectiveConfig) !== "local";

        if (!adminAvailable) {
          logger.info(
            `Admin panel disabled for "${command}" with local storage (only available via "astro dev")`,
          );

          return;
        }

        // Everything the admin does is a server request now, so the admin page
        // and the API are rendered on demand together. An adapter is what makes
        // that possible; `astro dev` renders on demand regardless, which is why
        // this is a warning there and an error in a build.
        if (command === "build" && !astroConfig.adapter) {
          throw new Error(
            "astronaut-cms needs an SSR adapter: the CMS holds the repository session on the server, so its API routes have to render on demand. Add one (e.g. @astrojs/node, @astrojs/cloudflare, @astrojs/vercel, @astrojs/netlify) to astro.config.",
          );
        }

        injectRoute({
          pattern: mountPoint,
          entrypoint: routeEntrypoint("astronaut-cms/admin.astro"),
          prerender: false,
        });
        injectRoute({
          pattern: API_PATTERN,
          entrypoint: routeEntrypoint("astronaut-cms/endpoint"),
          prerender: false,
        });

        logger.info(`Admin panel will be available at ${mountPoint}`);

        // Named once here rather than discovered at the sign-in screen: every one
        // of these is a deploy-time secret the CMS cannot invent for itself. The
        // session cookie's key is derived from the OAuth client secret, so it is
        // deliberately not on this list.
        const required: string[] = [];

        if (serverConfig.storage.type === "github") required.push(GITHUB_CLIENT_SECRET_ENV);
        if (serverConfig.storage.type === "gitlab") required.push(GITLAB_CLIENT_SECRET_ENV);
        if (mediaServer?.access.type === "s3") required.push(S3_ACCESS_KEY_ID_ENV);

        if (required.length) logger.info(`Set these on the server: ${required.join(", ")}`);

        if (mediaServer?.access.type === "binding") {
          logger.info(`Media library reached through the R2 binding "${mediaServer.access.name}"`);
        }

        if (config.ai?.enabled) {
          if (!config.ai.models?.length) {
            throw new Error("AI assistant: 'models' must list at least one gateway model id.");
          }

          if (!config.ai.gateway) {
            throw new Error("AI assistant: 'gateway' is required (e.g. { type: \"netlify\" }).");
          }

          // The platform-injected gateways resolve their base URL from server
          // environment variables, so there is nothing to hand the browser.
          if (isByok(effectiveConfig) && !isAddressable(config.ai.gateway)) {
            throw new Error(
              `AI assistant: credentials: "byok" needs a gateway the browser can address ("cloudflare" or "custom"), not "${config.ai.gateway.type}". The editor's key is sent straight to the gateway, so its URL has to be known at build time.`,
            );
          }

          logger.info(
            `AI assistant enabled${isByok(effectiveConfig) ? " (each editor brings their own key)" : ""}`,
          );
        }
      },
    },
  };
}
