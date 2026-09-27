import { envField } from "astro/config";
import type { CmsConfig, MediaServerConfig } from "./types.ts";
import {
  GITHUB_CLIENT_SECRET_ENV,
  GITLAB_CLIENT_SECRET_ENV,
  SESSION_SECRET_ENV,
} from "../shared/auth.ts";
import {
  S3_ACCESS_KEY_ID_ENV,
  S3_SECRET_ACCESS_KEY_ENV,
  S3_SESSION_TOKEN_ENV,
} from "../shared/media.ts";
import { AI_API_KEY_ENV } from "../shared/ai.ts";

type SecretField = ReturnType<typeof envField.string>;

/**
 * The secrets the injected routes read, declared through `astro:env` so the site
 * types them without declaring anything itself. Every one is optional: a host
 * such as Workers holds its secrets only at runtime, so a build with
 * `validateSecrets` must not demand them, and the route names a missing one on
 * the request that needs it.
 *
 * `configuredMedia` is the object store the config names.
 */
export function secretsSchema(
  config: CmsConfig,
  configuredMedia: MediaServerConfig | null,
): Record<string, SecretField> {
  const names: string[] = [];
  const provider = config.storage?.type;

  if (provider === "github" || provider === "gitlab") {
    names.push(
      provider === "github" ? GITHUB_CLIENT_SECRET_ENV : GITLAB_CLIENT_SECRET_ENV,
      SESSION_SECRET_ENV,
    );
  }

  if (configuredMedia?.access.type === "s3") {
    names.push(S3_ACCESS_KEY_ID_ENV, S3_SECRET_ACCESS_KEY_ENV, S3_SESSION_TOKEN_ENV);
  }

  if (config.ai?.enabled && config.ai.gateway?.type === "custom") names.push(AI_API_KEY_ENV);

  return Object.fromEntries(
    names.map((name) => [
      name,
      envField.string({ context: "server", access: "secret", optional: true }),
    ]),
  );
}
