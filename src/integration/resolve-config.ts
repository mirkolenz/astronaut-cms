/**
 * The one place CMS defaults are applied. Every consumer — the integration hook,
 * the virtual `config` module and therefore the whole admin bundle — reads the
 * resolved {@link CmsClientConfig}, so a default can never be restated (and drift)
 * at a second site. Fields are non-optional here by design: the client may rely on
 * them being present rather than re-defaulting.
 */
import type { AstroConfig } from "astro";
import type { AiGateway, CmsClientConfig, CmsConfig } from "./types.ts";
import type { ContentI18n } from "../shared/i18n.ts";
import { DEFAULT_AI_MAX_STEPS } from "../shared/ai.ts";

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

export function resolveContentI18n(
  config: CmsConfig,
  astroI18n: AstroI18n | undefined,
): ContentI18n | null {
  if (config.i18n === false) return null;

  const locales =
    config.i18n?.locales ?? astroI18n?.locales.map((l) => (typeof l === "string" ? l : l.path));
  const defaultLocale = config.i18n?.defaultLocale ?? astroI18n?.defaultLocale ?? locales?.[0];

  if (!locales?.length || !defaultLocale) return null;

  return { locales, defaultLocale };
}

export function resolveClientConfig(
  config: CmsConfig,
  trailingSlash: "always" | "never" | "ignore",
  astroI18n: AstroI18n | undefined,
): CmsClientConfig {
  const storage = config.storage ?? { type: "local" as const };

  return {
    mountPoint: config.mountPoint ?? DEFAULT_MOUNT_POINT,
    storageType: storage.type,
    trailingSlash,
    mediaDirectory: config.media?.directory ?? DEFAULT_MEDIA_DIRECTORY,
    mediaExtensions: config.media?.allowedExtensions ?? DEFAULT_MEDIA_EXTENSIONS,
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
        scopes: storage.authMode === "github-app" ? [] : (storage.scopes ?? ["repo"]),
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
 * Media-directory-relative globs the build bundles even when no content
 * references them. Build-only, like {@link resolveAiGateway}, so it stays out of
 * the client config the admin bundle carries.
 */
export function resolveAlwaysInclude(config: CmsConfig): string[] {
  return config.media?.alwaysInclude ?? [];
}

/**
 * Server-only gateway config. It is imported solely by the relay route, so it is
 * bundled into the SSR output and never reaches the client.
 */
export function resolveAiGateway(config: CmsConfig): AiGateway | null {
  return config.ai?.enabled ? (config.ai.gateway ?? null) : null;
}
