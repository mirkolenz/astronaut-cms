import { envField } from "astro/config";
import type { CmsConfig, CmsServerConfig, MediaServerConfig } from "./types.ts";
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

const secret = (required: boolean): SecretField =>
  envField.string({ context: "server", access: "secret", optional: !required });

/**
 * The secrets the injected routes read, declared through `astro:env` so the site
 * validates and types them without declaring anything itself. Each is required
 * exactly where this run needs it: `astro dev` on the working tree needs neither
 * the OAuth secret nor the bucket's keys, so they stay optional there.
 *
 * `configuredMedia` is the object store the config names, and `serverConfig`
 * with `mediaServer` what this run actually reaches.
 */
export function secretsSchema(
  config: CmsConfig,
  serverConfig: CmsServerConfig,
  configuredMedia: MediaServerConfig | null,
  mediaServer: MediaServerConfig | null,
): Record<string, SecretField> {
  const schema: Record<string, SecretField> = {};
  const provider = config.storage?.type;

  if (provider === "github" || provider === "gitlab") {
    const name = provider === "github" ? GITHUB_CLIENT_SECRET_ENV : GITLAB_CLIENT_SECRET_ENV;

    schema[name] = secret(serverConfig.storage.type === provider);
    schema[SESSION_SECRET_ENV] = secret(false);
  }

  if (configuredMedia?.access.type === "s3") {
    const required = mediaServer?.access.type === "s3";

    schema[S3_ACCESS_KEY_ID_ENV] = secret(required);
    schema[S3_SECRET_ACCESS_KEY_ENV] = secret(required);
    schema[S3_SESSION_TOKEN_ENV] = secret(false);
  }

  if (config.ai?.enabled && config.ai.gateway?.type === "custom") {
    schema[AI_API_KEY_ENV] = secret(false);
  }

  return schema;
}
