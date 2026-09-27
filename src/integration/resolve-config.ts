/**
 * The one place CMS defaults are applied. Every consumer — the integration hook,
 * the virtual `config` module and therefore the whole admin bundle — reads the
 * resolved {@link CmsClientConfig}, so a default can never be restated (and drift)
 * at a second site. Fields are non-optional here by design: the client may rely on
 * them being present rather than re-defaulting.
 */
import type { AstroConfig } from "astro";
import type {
  AiLimits,
  AiServerConfig,
  CmsClientConfig,
  CmsConfig,
  GitHubAuthMode,
  MediaBackendConfig,
  MediaServerConfig,
} from "./types.ts";
import type { ClientMediaBackend } from "../shared/media.ts";
import { trimSlashes } from "../shared/url.ts";
import type { ContentI18n } from "../shared/i18n.ts";
import { DEFAULT_AI_MAX_STEPS } from "../shared/ai.ts";
import { presignedUploadOrigin } from "../media/store.ts";

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

export function resolveClientConfig(
  config: CmsConfig,
  trailingSlash: "always" | "never" | "ignore",
  astroI18n: AstroI18n | undefined,
  localMedia: boolean,
): CmsClientConfig {
  const storage = config.storage ?? { type: "local" as const };

  return {
    mountPoint: config.mountPoint ?? DEFAULT_MOUNT_POINT,
    storageType: storage.type,
    trailingSlash,
    mediaDirectory: config.media?.directory ?? DEFAULT_MEDIA_DIRECTORY,
    // Lower-cased once here, so `hasAllowedExtension` never re-normalizes the list.
    mediaExtensions: (config.media?.allowedExtensions ?? DEFAULT_MEDIA_EXTENSIONS).map((ext) =>
      ext.toLowerCase(),
    ),
    maxFileSize: config.media?.maxFileSize ?? null,
    mediaAlwaysInclude: resolveAlwaysInclude(config),
    mediaBackend: resolveClientMediaBackend(config, localMedia),
    locale: config.locale ?? "en",
    contentI18n: resolveContentI18n(config, astroI18n),
    previewUrl: config.previewUrl,
    ...(config.ai?.enabled &&
      config.ai.models?.length && {
        ai: {
          models: config.ai.models,
          maxSteps: config.ai.maxSteps ?? DEFAULT_AI_MAX_STEPS,
        },
      }),
    ...(storage.type === "github" && {
      github: {
        repo: storage.repo,
        branch: storage.branch ?? "main",
        clientId: storage.clientId,
        flow: storage.flow ?? "device",
        // A GitHub App derives its permissions from the installation and ignores
        // the scope parameter, so it resolves to none rather than to a default
        // the client would then have to know to drop.
        scopes: githubAuthMode(storage) === "github-app" ? [] : (storage.scopes ?? ["repo"]),
        publishMode: storage.publishMode ?? "direct",
      },
    }),
    ...(storage.type === "gitlab" && {
      gitlab: {
        project: storage.project,
        branch: storage.branch ?? "main",
        clientId: storage.clientId,
        instanceUrl: storage.instanceUrl ?? "https://gitlab.com",
        scopes: storage.scopes ?? ["api"],
        publishMode: storage.publishMode ?? "direct",
      },
    }),
  };
}

/**
 * How the editor's GitHub token is issued. A GitHub App is the default because
 * the token it hands the browser is the least dangerous one to hold: limited to
 * the repositories the app is installed on, to the permissions it declares, and
 * — when the app is configured that way — expiring. A classic OAuth App can only
 * issue a coarse, non-expiring `repo` token covering everything the editor can
 * reach, which is a poor thing to keep in a tab.
 */
export function githubAuthMode(storage: { authMode?: GitHubAuthMode }): GitHubAuthMode {
  return storage.authMode ?? "github-app";
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

  const uploadOrigin = presignOrigin(resolveMediaServer(config));

  return {
    type: "remote",
    publicUrl: trimSlashes(backend.publicUrl),
    ...(uploadOrigin && { uploadOrigin }),
    ...(localMedia && { local: true }),
  };
}

/**
 * Origin of the presigned URL the browser uploads to, which the admin's CSP has
 * to allow. A store reached solely through a Workers binding presigns nothing
 * and proxies instead, so it has none.
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
    binding: backend.type === "r2" ? backend.binding ?? null : null,
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
  requestsPerMinute: 60,
  concurrency: 4,
};

/**
 * Server-only gateway config. It is imported solely by the relay route, so it is
 * bundled into the SSR output and never reaches the client.
 */
export function resolveAiServer(config: CmsConfig): AiServerConfig | null {
  if (!config.ai?.enabled || !config.ai.gateway) return null;

  return {
    gateway: config.ai.gateway,
    limits: { ...DEFAULT_AI_LIMITS, ...config.ai.limits },
  };
}
