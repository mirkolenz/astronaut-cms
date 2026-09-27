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
  ServerStorageConfig,
} from "./types.ts";
import { presignedUploadOrigin, type ClientMediaBackend } from "../shared/media.ts";
import { trimSlashes } from "../shared/url.ts";
import type { ContentI18n } from "../shared/i18n.ts";
import { DEFAULT_AI_MAX_STEPS } from "../shared/ai.ts";
import { parseRepo } from "../shared/repo.ts";

export const DEFAULT_MOUNT_POINT = "/admin";
export const DEFAULT_MEDIA_DIRECTORY = "src/assets";

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

export const storageType = (config: CmsConfig): "local" | "github" | "gitlab" =>
  config.storage?.type ?? "local";

/** Lower-cased once, so `hasAllowedExtension` never re-normalizes the list. */
const mediaExtensions = (config: CmsConfig): string[] =>
  (config.media?.allowedExtensions ?? DEFAULT_MEDIA_EXTENSIONS).map((ext) => ext.toLowerCase());

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
        },
      }),
  };
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
    ...(backend.publicUrl && { publicUrl: trimSlashes(backend.publicUrl) }),
    ...(storeOrigin && { storeOrigin }),
    ...(localMedia && { local: true }),
  };
}

/**
 * Origin the store's S3 API is reached at, which is where every signed URL
 * points. A store reached solely through a Workers binding signs nothing and
 * proxies instead, so it has none.
 */
function presignOrigin(media: MediaServerConfig | null): string | undefined {
  if (!media?.s3) return undefined;

  return presignedUploadOrigin({ ...media.s3, bucket: media.bucket });
}

/**
 * Server-only, imported by the injected route alone, so a bucket, endpoint or
 * binding name never reaches the client. The R2 preset is the S3 backend with
 * Cloudflare's endpoint filled in.
 */
export function resolveMediaServer(config: CmsConfig): MediaServerConfig | null {
  const backend = mediaBackend(config);

  if (backend.type === "repo") return null;

  // An R2 bucket reached only through a Workers binding has no S3 target at all.
  const s3 =
    backend.type === "r2"
      ? backend.accountId
        ? {
            endpoint: `https://${backend.accountId}.r2.cloudflarestorage.com`,
            region: "auto",
            pathStyle: true,
          }
        : null
      : {
          endpoint: trimSlashes(backend.endpoint),
          region: backend.region ?? "auto",
          pathStyle: backend.forcePathStyle ?? false,
        };

  return {
    bucket: backend.bucket,
    prefix: backend.prefix ? `${trimSlashes(backend.prefix)}/` : "",
    s3,
    binding: backend.type === "r2" ? (backend.binding ?? null) : null,
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

function resolveAiServer(config: CmsConfig): AiServerConfig | null {
  if (!config.ai?.enabled || !config.ai.gateway) return null;

  return {
    gateway: config.ai.gateway,
    maxSteps: maxSteps(config),
    limits: { ...DEFAULT_AI_LIMITS, ...config.ai.limits },
  };
}
