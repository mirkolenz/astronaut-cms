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
  MediaServerConfig,
  RepoMediaConfig,
  ResolvedImageOptimization,
  S3MediaConfig,
  ServerStorageConfig,
} from "./types.ts";
import {
  s3BaseUrl,
  type ClientLibrary,
  type ClientMediaConfig,
  type S3Target,
} from "../shared/media.ts";
import { trimSlashes } from "../shared/url.ts";
import type { ContentI18n } from "../shared/i18n.ts";
import {
  DEFAULT_AI_MAX_STEPS,
  gatewayAddress,
  type AiGateway,
  type GatewayEndpoint,
} from "../shared/ai.ts";
import { parseRepo } from "../shared/repo.ts";
import type { CollectionManifest } from "../shared/types.ts";

export const DEFAULT_MOUNT_POINT = "/admin";
export const DEFAULT_MEDIA_DIRECTORY = "src/assets";
export const DEFAULT_S3_DEV_DIRECTORY = ".astronaut-cms/s3";

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

export function resolveClientConfig(
  config: CmsConfig,
  astroI18n: AstroI18n | undefined,
  s3DevDirectory: string | null,
  collections: CollectionManifest,
): CmsClientConfig {
  const type = storageType(config);

  return {
    mountPoint: config.mountPoint ?? DEFAULT_MOUNT_POINT,
    storageType: type,
    media: resolveClientMedia(config, s3DevDirectory),
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
          ...(isByok(config) && { byok: byokEndpoint(config.ai.gateway) }),
        },
      }),
    ...(config.webmcp?.enabled && {
      webmcp: { originTrialToken: config.webmcp.originTrialToken },
    }),
    collections,
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

/** What every library resolves alike. */
function resolveLibrary(library: RepoMediaConfig | S3MediaConfig | undefined): ClientLibrary {
  const optimize = library?.optimizeImages;

  return {
    label: library?.label ?? null,
    // Lower-cased once, so `isLibraryFile` never re-normalizes the list.
    extensions: library?.allowedExtensions?.map((ext) => ext.toLowerCase()) ?? null,
    minFileSize: library?.minFileSize ?? null,
    maxFileSize: library?.maxFileSize ?? null,
    imageOptimization: optimize === false ? null : { ...DEFAULT_IMAGE_OPTIMIZATION, ...optimize },
  };
}

/**
 * Enough for the admin to address a file, and nothing an object store could be
 * reached with. `s3DevDirectory` only says where the store's bytes are during a
 * dev run: the reference format is the store's either way, so it cannot differ
 * between a dev run and the build.
 */
function resolveClientMedia(config: CmsConfig, s3DevDirectory: string | null): ClientMediaConfig {
  const { repo, s3 } = config.media ?? {};

  return {
    repo: {
      ...resolveLibrary(repo),
      directory: repo?.directory ?? DEFAULT_MEDIA_DIRECTORY,
      alwaysInclude: repo?.alwaysInclude ?? [],
    },
    s3: s3
      ? {
          ...resolveLibrary(s3),
          publicUrl: trimSlashes(s3.publicUrl),
          // Where every presigned upload goes, which the admin's CSP has to allow.
          storeOrigin: s3BaseUrl(storeS3(s3)).origin,
          ...(s3DevDirectory != null && { directory: s3DevDirectory }),
        }
      : null,
  };
}

/**
 * Server-only, imported by the injected route alone, so a bucket or endpoint
 * never reaches the client.
 */
export function resolveMediaServer(config: CmsConfig): MediaServerConfig | null {
  const s3 = config.media?.s3;

  if (!s3) return null;

  return {
    publicUrl: trimSlashes(s3.publicUrl),
    prefix: s3.prefix ? `${trimSlashes(s3.prefix)}/` : "",
    s3: storeS3(s3),
  };
}

/** The R2 preset is the S3 API with Cloudflare's endpoint filled in. */
function storeS3(s3: S3MediaConfig): S3Target {
  if (s3.provider === "r2") {
    return {
      endpoint: `https://${s3.accountId}.r2.cloudflarestorage.com`,
      pathStyle: true,
      bucket: s3.bucket,
    };
  }

  return {
    endpoint: trimSlashes(s3.endpoint),
    region: s3.region,
    pathStyle: s3.forcePathStyle ?? false,
    bucket: s3.bucket,
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
  trailingSlash: AstroConfig["trailingSlash"],
): CmsServerConfig {
  return {
    trailingSlash,
    storage: resolveServerStorage(config, rootDir),
    media,
    ai: resolveAiServer(config),
  };
}

/** Defaults for {@link AiLimits}: generous for an editor, bounded for a bill. */
const DEFAULT_AI_LIMITS: Required<AiLimits> = {
  maxRequestBytes: 1024 * 1024,
  maxOutputTokens: 8192,
};

const maxSteps = (config: CmsConfig): number => config.ai?.maxSteps ?? DEFAULT_AI_MAX_STEPS;

/** Where a browser holding the editor's own key sends inference, checked to be one by `validateAi`. */
function byokEndpoint(gateway: AiGateway): GatewayEndpoint | undefined {
  const address = gatewayAddress(gateway);

  return address ? { baseUrl: address.baseUrl, headers: address.headers } : undefined;
}

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
