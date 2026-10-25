import type { AstroIntegration } from "astro";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "pathe";
import type { CmsConfig } from "./types.ts";
import { API_BASE, API_CALLBACK, API_PATTERN, LICENSES_PATH } from "../shared/auth.ts";
import { gatewayAddress } from "../shared/ai.ts";
import { conformTrailingSlash, trimSlashes } from "../shared/url.ts";
import { megabytes } from "../shared/media.ts";
import { cmsVitePlugin } from "./vite-plugin.ts";
import { cmsDevPlugin } from "./dev-middleware.ts";
import { loadConfigs } from "./load-config.ts";
import { secretsSchema } from "./env-schema.ts";
import { sitemapListsAdmin } from "./sitemap-check.ts";
import { checkContent, missingSingletons } from "./check-content.ts";
import { mediaGraph, type MediaGraph } from "./media-graph.ts";
import { contentEntries } from "./content-files.ts";
import { componentModules, componentTypes, writeModules } from "./component-codegen.ts";
import { unexposable } from "../shared/tools/exposable.ts";
import {
  DEFAULT_S3_DEV_DIRECTORY,
  isByok,
  resolveClientConfig,
  resolveMediaServer,
  resolveServerConfig,
  storageType,
} from "./resolve-config.ts";

export type {
  CmsConfig,
  StorageConfig,
  MediaConfig,
  RepoMediaConfig,
  S3MediaConfig,
  S3EndpointMediaConfig,
  R2MediaConfig,
  SupportedLocale,
} from "./types.ts";
export type { ContentI18n } from "../shared/i18n.ts";
export { defineCollection, defineComponent, file, libraryImage } from "../config.ts";
export type {
  CollectionOptions,
  CollectionSort,
  ComponentDefinition,
  ChildrenConfig,
  SchemaHelpers,
} from "../config.ts";

const CONFIG_EXTENSIONS = ["ts", "tsx", "mts", "js", "jsx", "mjs"];

// This module, which the package's watch build rewrites on every server rebuild.
const INTEGRATION_PATH = fileURLToPath(import.meta.url);

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
  const pathname = trimSlashes(url.pathname);

  return {
    protocol: url.protocol.slice(0, -1),
    hostname: url.hostname,
    ...(pathname && { pathname: `/${pathname}/**` }),
  };
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

/** What an enabled assistant has to declare before any of it is resolved. */
function validateAi(config: CmsConfig): void {
  if (!config.ai?.enabled) return;

  if (!config.ai.models?.length) {
    throw new Error("AI assistant: 'models' must list at least one gateway model id.");
  }

  if (!config.ai.gateway) {
    throw new Error("AI assistant: 'gateway' is required (e.g. { type: \"netlify\" }).");
  }

  // The editor's key goes straight to the gateway, so its address has to be
  // known at build time and the gateway has to answer a browser.
  if (isByok(config) && !gatewayAddress(config.ai.gateway)?.byok) {
    throw new Error(
      `AI assistant: credentials: "byok" needs a gateway a browser can call with the editor's key ("cloudflare" or "custom"), not "${config.ai.gateway.type}".`,
    );
  }
}

/** Everything an object-store library has to declare before it can be reached. */
function validateS3(config: CmsConfig, site: string | undefined): void {
  const s3 = config.media?.s3;

  if (!s3) return;

  if (!s3.bucket) throw new Error("media.s3: 'bucket' is required.");

  if (!s3.publicUrl) {
    throw new Error(
      "media.s3: 'publicUrl' is required, the base the library's keys are served under (e.g. 'https://cdn.example.com').",
    );
  }

  validateMediaOrigin(s3.publicUrl, site);

  if (s3.provider === "r2") {
    if (!s3.accountId) throw new Error("media.s3: 'accountId' is required for R2, for the S3 API endpoint.");
  } else if (!s3.endpoint) {
    throw new Error(
      "media.s3: 'endpoint' is required (e.g. 'https://s3.eu-central-1.amazonaws.com').",
    );
  }
}

/**
 * Narrows `resolveImage` to the libraries the site configures, so the call
 * sites of a site without an object store never handle a URL they cannot receive,
 * and names the collections `cms.config` may point to.
 */
function registryTypes(s3: boolean, collections: string[]): string {
  return `declare module "astronaut-cms/assets" {
  interface MediaRegistry {
    s3: ${s3};
  }
}

declare module "astronaut-cms/config" {
  interface CollectionRegistry {
    name: ${collections.map((name) => JSON.stringify(name)).join(" | ") || "never"};
  }
}

export {};
`;
}

export default function cms(config: CmsConfig = {}): AstroIntegration {
  let adminPath = "/";
  let graph: MediaGraph | null = null;
  // Written once the config is set up, injected once astro allows it.
  let injectedTypes: { filename: string; content: string }[] = [];

  return {
    name: "astronaut-cms",
    hooks: {
      "astro:config:setup": async ({
        config: astroConfig,
        command,
        injectRoute,
        updateConfig,
        addWatchFile,
        createCodegenDir,
        logger,
      }) => {
        const rootDir = fileURLToPath(astroConfig.root);

        // `astro dev` edits the working tree rather than the configured backends, so
        // running the admin needs neither OAuth credentials nor the production bucket.
        const configuredStorage = storageType(config);
        const s3 = config.media?.s3;
        const devStorage =
          command === "dev" && (config.localStorageInDev ?? true) && configuredStorage !== "local";
        // The working-tree stand-in for the store is reached through the dev file
        // API, so it only exists where content is edited locally too. Only the
        // bytes move: the reference format stays the store's, so an entry edited
        // in dev builds unchanged.
        const wantedDevDirectory =
          command === "dev" && s3 && s3.devDirectory !== false
            ? (s3.devDirectory ?? DEFAULT_S3_DEV_DIRECTORY)
            : null;
        const s3DevDirectory =
          devStorage || configuredStorage === "local" ? wantedDevDirectory : null;

        const effectiveConfig: CmsConfig = {
          ...config,
          ...(devStorage && { storage: { type: "local" as const } }),
        };

        if (devStorage) {
          logger.info(
            `Using local storage for "astro dev" (configured "${config.storage?.type}" backend will be used in build)`,
          );
        }

        if (wantedDevDirectory != null) {
          logger.info(
            s3DevDirectory != null
              ? `Object-store library served from "${s3DevDirectory}" for "astro dev" (the bucket is used in build; references keep its URL format either way)`
              : `Editing the configured bucket in "astro dev": media.s3.devDirectory needs local storage, and this run uses "${configuredStorage}". Uploads and deletions here reach the bucket the deployed site serves.`,
          );
        }

        // Before anything reads the store: resolving it assumes a complete one,
        // and a field that is missing rather than wrong would otherwise surface
        // as a TypeError from deep inside the resolver.
        validateS3(effectiveConfig, astroConfig.site);
        validateAi(config);

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
        const mediaServer = s3DevDirectory != null ? null : resolveMediaServer(effectiveConfig);

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
            logger.info("No cms.config found, using defaults");
          }
        }

        // Auto-discover and load content.config.{ts,mts,js,mjs}
        const contentConfigPath = findConfig(rootDir, "src/content.config");

        if (contentConfigPath) {
          logger.info(`Found content config at ${contentConfigPath}`);
        } else {
          logger.warn("No content.config found, collections will be empty");
        }

        // Read once, for the check below and the components the server validates against.
        const { collections, components, componentFiles } = await loadConfigs(
          rootDir,
          { content: contentConfigPath, cms: userConfigPath },
          (message) => logger.warn(message),
        );

        // A wrapper per component applies its schema defaults, which MDX would
        // otherwise hand it as written, and `astronaut-cms:components` maps them all.
        const codegenDir = fileURLToPath(createCodegenDir());

        writeModules(join(codegenDir, "components"), componentModules(userConfigPath, componentFiles));

        // The integration reads both at startup, so an edit restarts the dev server.
        // So does a rebuild of the integration itself, which only a linked checkout
        // sees, since the dev server watches nothing below `node_modules`.
        for (const path of [contentConfigPath, userConfigPath, INTEGRATION_PATH]) {
          if (path) addWatchFile(path);
        }

        // Every default is applied once, here; `clientConfig` is what the admin
        // and the rest of this hook both read.
        const clientConfig = resolveClientConfig(
          effectiveConfig,
          astroConfig.i18n,
          s3DevDirectory,
          collections,
        );
        const mountPoint = clientConfig.mountPoint;
        adminPath = join("/", astroConfig.base, mountPoint);

        if (clientConfig.contentI18n) {
          const { locales, defaultLocale } = clientConfig.contentI18n;
          logger.info(
            `Multilingual content enabled for locales ${locales.join(", ")} (default: ${defaultLocale})`,
          );
        }
        const readsContent = command === "build" || command === "dev";
        const entries = readsContent ? contentEntries(rootDir, collections, components) : [];

        // Content the admin would refuse to save fails a build, where whoever
        // committed it sees it, rather than surfacing later at an editor's save.
        const problems = readsContent
          ? [...checkContent(entries, rootDir, clientConfig.media), ...missingSingletons(collections, entries)]
          : [];

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

        const serverConfig = resolveServerConfig(
          effectiveConfig,
          rootDir,
          mediaServer,
          astroConfig.trailingSlash,
        );

        // The working tree is only reachable from Node, so `astro dev` answers the
        // API itself there, whatever runtime the adapter renders in.
        const devApi = command === "dev" && serverConfig.storage.type === "local";

        const { s3: s3Library } = clientConfig.media;

        injectedTypes = [
          { filename: "types.d.ts", content: registryTypes(s3Library != null, Object.keys(collections)) },
          {
            filename: "components.d.ts",
            content: componentTypes(codegenDir, userConfigPath, Object.keys(componentFiles)),
          },
        ];
        graph = mediaGraph({
          rootDir,
          srcDir: fileURLToPath(astroConfig.srcDir),
          media: clientConfig.media,
          ignore: [mountPoint, API_PATTERN],
        });

        updateConfig({
          ...(s3Library && {
            image: { remotePatterns: [mediaRemotePattern(s3Library.publicUrl)] },
          }),
          env: { schema: secretsSchema(config) },
          vite: {
            plugins: [
              ...cmsVitePlugin({
                clientConfig,
                serverConfig,
                userConfigPath,
                components,
                componentsEntry: join(codegenDir, "components/index.ts"),
                rootDir,
              }),
              ...graph.plugins,
              // The admin writes files the dev server watches; without this every
              // save reloads the page and wipes its state.
              ...(command === "dev"
                ? [cmsDevPlugin(devApi ? join("/", astroConfig.base, API_BASE) : null)]
                : []),
            ],
            // Every entry ships bundled already, and a site's editors import the
            // admin's primitives, which have to be its own module instances.
            // Pre-bundled, an entry would be a copy of what it shares.
            // The admin imports the CMS config, which Astro's client scan skips
            // as a `.ts` file. Its dependencies would then be optimized late,
            // and the reload that follows 504s modules already served.
            optimizeDeps: {
              exclude: ["astronaut-cms"],
              ...(userConfigPath && { entries: [userConfigPath] }),
            },
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
          entrypoint: "astronaut-cms/admin.astro",
          prerender: false,
        });
        injectRoute({
          pattern: API_PATTERN,
          entrypoint: "astronaut-cms/endpoint",
          prerender: false,
        });
        // A deployed admin distributes the packages its bundles inline, so their notices travel with it.
        injectRoute({
          pattern: LICENSES_PATH,
          entrypoint: "astronaut-cms/licenses",
          prerender: true,
        });

        logger.info(`Admin panel will be available at ${mountPoint}`);

        // What the OAuth app has to name, spelled the way this site's routes
        // answer, since a provider matches the redirect URI exactly.
        if (serverConfig.storage.type !== "local") {
          const callback = new URL(
            join("/", astroConfig.base, API_CALLBACK),
            astroConfig.site ?? "https://your-site.example",
          ).href;

          logger.info(
            `OAuth callback URL: ${conformTrailingSlash(callback, astroConfig.trailingSlash)}`,
          );
        }

        if (config.ai?.enabled) {
          logger.info(
            `AI assistant enabled${isByok(effectiveConfig) ? " (each editor brings their own key)" : ""}`,
          );
        }
      },

      "astro:config:done": ({ injectTypes }) => {
        for (const types of injectedTypes) injectTypes(types);
      },

      // Outside the site's root, so the dev server has to be told to watch it.
      "astro:server:setup": ({ server }) => {
        server.watcher.add(INTEGRATION_PATH);
      },

      "astro:routes:resolved": ({ routes }) => graph?.setRoutes(routes),

      "astro:build:done": ({ dir, logger }) => {
        const clientDir = fileURLToPath(dir);

        // The sitemap lists every page route, the injected admin included, and
        // exposes no way for another integration to take one out.
        if (sitemapListsAdmin(clientDir, adminPath)) {
          logger.warn(
            `The sitemap lists the admin at ${adminPath}. Exclude it with sitemap({ filter: (page) => !new URL(page).pathname.startsWith("${adminPath}") }).`,
          );
        }

        const prune = config.media?.repo?.prune;

        if (!graph || prune === false) return;

        const removed = graph.prune(clientDir, prune === true);

        if (!removed) {
          logger.info(
            `Kept media library files because on-demand code (${graph.onDemand.join(", ") || "server islands"}) may render them. Set media.repo.prune to true if it never does.`,
          );

          return;
        }

        if (removed.size === 0) return;

        const size = [...removed.values()].reduce((sum, bytes) => sum + bytes, 0);

        logger.info(`Removed ${removed.size} media library files no delivered file links (${megabytes(size)}).`);
      },
    },
  };
}
