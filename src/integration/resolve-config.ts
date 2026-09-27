/**
 * The one place CMS defaults are applied. Every consumer — the integration hook,
 * the virtual `config` module and therefore the whole admin bundle — reads the
 * resolved {@link CmsClientConfig}, so a default can never be restated (and drift)
 * at a second site. Fields are non-optional here by design: the client may rely on
 * them being present rather than re-defaulting.
 */
import type { AiGateway, CmsClientConfig, CmsConfig } from "./types.ts";
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

export function resolveClientConfig(
  config: CmsConfig,
  trailingSlash: "always" | "never" | "ignore",
): CmsClientConfig {
  const storage = config.storage ?? { type: "local" as const };

  return {
    mountPoint: config.mountPoint ?? DEFAULT_MOUNT_POINT,
    storageType: storage.type,
    trailingSlash,
    mediaDirectory: config.media?.directory ?? DEFAULT_MEDIA_DIRECTORY,
    mediaExtensions: config.media?.allowedExtensions ?? DEFAULT_MEDIA_EXTENSIONS,
    locale: config.locale ?? "en",
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
        authMode: storage.authMode ?? "oauth-app",
        scopes: storage.scopes ?? ["repo"],
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
 * Server-only gateway config. It is imported solely by the relay route, so it is
 * bundled into the SSR output and never reaches the client.
 */
export function resolveAiGateway(config: CmsConfig): AiGateway | null {
  return config.ai?.enabled ? (config.ai.gateway ?? null) : null;
}
