/**
 * The one place CMS defaults are applied, and the one place the config is split
 * in two: what the admin bundle may hold ({@link CmsClientConfig}) and what only
 * the injected route may ({@link CmsServerConfig}). Every consumer reads a
 * resolved config, so a default can never be restated (and drift) at a second
 * site, and nothing server-only can reach the browser by accident.
 */
import type { AstroConfig } from "astro";
import type {
  AiLimits,
  AiServerConfig,
  CmsClientConfig,
  CmsConfig,
  CmsServerConfig,
  MediaBackendConfig,
  MediaServerConfig,
  ResolvedImageOptimization,
  ServerStorageConfig,
} from "./types.ts";
import { presignedUploadOrigin, type ClientMediaBackend } from "../shared/media.ts";
import { trimSlashes } from "../shared/url.ts";
import type { ContentI18n } from "../shared/i18n.ts";
import type { CollectionManifest } from "../shared/types.ts";
import { DEFAULT_AI_MAX_STEPS, gatewayEndpoint, isAddressable } from "../shared/ai.ts";
import { parseRepo } from "../shared/repo.ts";

export const DEFAULT_MOUNT_POINT = "/admin";
export const DEFAULT_MEDIA_DIRECTORY = "src/assets";

/**
 * Content languages, taken from the site's own `astro.config` `i18n` block so a
 * multilingual site needs no second declaration. A locale entry may be a bare
 * code or a `{ path, codes }` pair; the `path` is the URL (and therefore the
 * content directory) segment, which is what entry ids are built from.
 */
type AstroI18n = Pick<NonNullable<AstroConfig["i18n"]>, "locales" | "defaultLocale">;

type AstroLocale = AstroI18n["locales"][number];

/** The URL (and therefore content directory) segment of an astro locale entry. */
function localeSegment(locale: AstroLocale): string {
  return typeof locale === "string" ? locale : locale.path;
}

/**
 * Astro's `defaultLocale` names a *code*, while `locales` are addressed by their
 * `path` — for `{ path: "english", codes: ["en"] }` the two differ. Entry ids are
 * built from paths, so the default is mapped into the same namespace before it
 * is used as one.
 */
function localePath(code: string, astroI18n: AstroI18n | undefined): string {
  for (const locale of astroI18n?.locales ?? []) {
    if (typeof locale !== "string" && locale.codes.includes(code)) return locale.path;
  }

  return code;
}

export function resolveContentI18n(
  config: CmsConfig,
  astroI18n: AstroI18n | undefined,
): ContentI18n | null {
  if (config.i18n === false) return null;

  const locales = config.i18n?.locales ?? astroI18n?.locales.map(localeSegment);
  const code = config.i18n?.defaultLocale ?? astroI18n?.defaultLocale;
  const defaultLocale = code ? localePath(code, astroI18n) : locales?.[0];

  if (!locales?.length || !defaultLocale) return null;

  return { locales, defaultLocale };
}

/**
 * The content config's collections with the integration's per-collection
 * options applied. An option naming no collection, or a file order for entries
 * that are separate files, is a mistake the site would otherwise never notice.
 */
export function resolveCollections(
  manifest: CollectionManifest,
  config: CmsConfig,
): CollectionManifest {
  const resolved = { ...manifest };

  for (const [name, { sort }] of Object.entries(config.collections ?? {})) {
    const collection = resolved[name];

    if (!collection) {
      throw new Error(`collections: "${name}" is not a collection of the content config.`);
    }

    if (sort === "file" && collection.loaderType !== "file") {
      throw new Error(
        `collections: "${name}" cannot sort by "file", which needs a file() collection. The entries of a glob() collection are separate files.`,
      );
    }

    if (sort) resolved[name] = { ...collection, sort };
  }

  return resolved;
}

export const storageType = (config: CmsConfig): "local" | "github" | "gitlab" =>
  config.storage?.type ?? "local";

/** Lower-cased once, so `isLibraryFile` never re-normalizes the list. Null admits any file. */
const mediaExtensions = (config: CmsConfig): string[] | null =>
  config.media?.allowedExtensions?.map((ext) => ext.toLowerCase()) ?? null;

const mediaDirectory = (config: CmsConfig): string =>
  config.media?.directory ?? DEFAULT_MEDIA_DIRECTORY;

export function resolveClientConfig(
  config: CmsConfig,
  trailingSlash: "always" | "never" | "ignore",
  astroI18n: AstroI18n | undefined,
  localMedia: boolean,
): CmsClientConfig {
  const type = storageType(config);

  return {
    mountPoint: config.mountPoint ?? DEFAULT_MOUNT_POINT,
    storageType: type,
    trailingSlash,
    mediaDirectory: mediaDirectory(config),
    mediaExtensions: mediaExtensions(config),
    maxFileSize: config.media?.maxFileSize ?? null,
    mediaAlwaysInclude: resolveAlwaysInclude(config),
    mediaBackend: resolveClientMediaBackend(config, localMedia),
    imageOptimization: resolveImageOptimization(config),
    locale: config.locale ?? "en",
    contentI18n: resolveContentI18n(config, astroI18n),
    previewUrl: config.previewUrl,
    // The working tree is already the live content: there is no draft branch to
    // merge in either direction, only changes to keep or throw away.
    capabilities: { publish: type !== "local", update: type !== "local" },
    ...(config.ai?.enabled &&
      config.ai.models?.length && {
        ai: {
          models: config.ai.models,
          maxSteps: maxSteps(config),
          // Present only when the editor brings the key: it is then the browser
          // that calls the gateway, so the browser has to know where it is.
          ...(isByok(config) &&
            isAddressable(config.ai.gateway) && { byok: gatewayEndpoint(config.ai.gateway) }),
        },
      }),
    ...(config.webmcp?.enabled && {
      webmcp: { originTrialToken: config.webmcp.originTrialToken },
    }),
  };
}

/**
 * Enough headroom for a print-quality master, low enough that a phone original
 * does not enter the library at 12 MP. The quality ladder is what makes
 * `maxFileSize` a threshold rather than a promise.
 */
const DEFAULT_IMAGE_OPTIMIZATION: ResolvedImageOptimization = {
  maxWidth: 2048,
  maxHeight: 2048,
  maxFileSize: 8 * 1024 * 1024,
  format: null,
  quality: 0.92,
  minQuality: 0.5,
};

function resolveImageOptimization(config: CmsConfig): ResolvedImageOptimization | null {
  const optimize = config.media?.optimizeImages;

  if (optimize === false) return null;

  return { ...DEFAULT_IMAGE_OPTIMIZATION, ...optimize };
}

const DEFAULT_MEDIA_BACKEND: MediaBackendConfig = { type: "repo" };

function mediaBackend(config: CmsConfig): MediaBackendConfig {
  return config.media?.backend ?? DEFAULT_MEDIA_BACKEND;
}

/**
 * Enough for the admin to address a file, and nothing an object store could be
 * reached with. `localMedia` only says where the bytes are: the reference format
 * is the configured backend's either way, so it cannot differ between a dev run
 * and the build.
 */
function resolveClientMediaBackend(config: CmsConfig, localMedia: boolean): ClientMediaBackend {
  const backend = mediaBackend(config);

  if (backend.type === "repo") return { type: "repo" };

  const storeOrigin = presignOrigin(resolveMediaServer(config));

  return {
    type: "remote",
    publicUrl: trimSlashes(backend.publicUrl),
    ...(storeOrigin && { storeOrigin }),
    ...(localMedia && { local: true }),
  };
}

/**
 * Origin the store's S3 API is reached at, which is where every presigned
 * upload points. A store reached solely through a Workers binding signs nothing and
 * proxies instead, so it has none.
 */
function presignOrigin(media: MediaServerConfig | null): string | undefined {
  if (media?.access.type !== "s3") return undefined;

  return presignedUploadOrigin({ ...media.access, bucket: media.bucket });
}

/**
 * Server-only, imported by the injected route alone, so a bucket, endpoint or
 * binding name never reaches the client. The R2 preset is the S3 backend with
 * Cloudflare's endpoint filled in.
 */
export function resolveMediaServer(config: CmsConfig): MediaServerConfig | null {
  const backend = mediaBackend(config);

  if (backend.type === "repo") return null;

  return {
    bucket: backend.bucket,
    publicUrl: trimSlashes(backend.publicUrl),
    prefix: backend.prefix ? `${trimSlashes(backend.prefix)}/` : "",
    access: storeAccess(backend),
  };
}

function storeAccess(
  backend: Exclude<MediaBackendConfig, { type: "repo" }>,
): MediaServerConfig["access"] {
  if (backend.type === "s3") {
    return {
      type: "s3",
      endpoint: trimSlashes(backend.endpoint),
      region: backend.region ?? "auto",
      pathStyle: backend.forcePathStyle ?? false,
    };
  }

  if (backend.binding) return { type: "binding", name: backend.binding };

  return {
    type: "s3",
    endpoint: `https://${backend.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    pathStyle: true,
  };
}

function resolveServerStorage(config: CmsConfig, rootDir: string): ServerStorageConfig {
  const storage = config.storage;

  if (storage?.type === "github") {
    const { owner, repo } = parseRepo(storage.repo);

    return {
      type: "github",
      owner,
      repo,
      branch: storage.branch ?? "main",
      clientId: storage.clientId,
      publishMode: storage.publishMode ?? "direct",
    };
  }

  if (storage?.type === "gitlab") {
    return {
      type: "gitlab",
      project: storage.project,
      branch: storage.branch ?? "main",
      instanceUrl: storage.instanceUrl ?? "https://gitlab.com",
      clientId: storage.clientId,
      scopes: storage.scopes ?? ["api"],
      publishMode: storage.publishMode ?? "direct",
    };
  }

  return { type: "local", rootDir };
}

export function resolveServerConfig(
  config: CmsConfig,
  rootDir: string,
  media: MediaServerConfig | null,
): CmsServerConfig {
  return {
    storage: resolveServerStorage(config, rootDir),
    media,
    ai: resolveAiServer(config),
    mediaDirectory: mediaDirectory(config),
    mediaExtensions: mediaExtensions(config),
    maxFileSize: config.media?.maxFileSize ?? null,
  };
}

/**
 * Media-directory-relative globs the build bundles even when no content
 * references them. The admin reads them too, to tell a file site code uses from
 * one nothing reaches.
 */
export function resolveAlwaysInclude(config: CmsConfig): string[] {
  return config.media?.alwaysInclude ?? [];
}

/** Defaults for {@link AiLimits}: generous for an editor, bounded for a bill. */
const DEFAULT_AI_LIMITS: Required<AiLimits> = {
  maxRequestBytes: 1024 * 1024,
  maxOutputTokens: 8192,
};

const maxSteps = (config: CmsConfig): number => config.ai?.maxSteps ?? DEFAULT_AI_MAX_STEPS;

/** Whether the editor supplies the credential rather than the deployment. */
export function isByok(config: CmsConfig): boolean {
  return config.ai?.credentials === "byok";
}

/**
 * Null when there is no relay to configure, which `byok` is one reason for: the
 * route then has no gateway to reach and refuses, because inference never
 * touches this deployment.
 */
function resolveAiServer(config: CmsConfig): AiServerConfig | null {
  if (!config.ai?.enabled || !config.ai.gateway || isByok(config)) return null;

  return {
    gateway: config.ai.gateway,
    maxSteps: maxSteps(config),
    limits: { ...DEFAULT_AI_LIMITS, ...config.ai.limits },
  };
}
