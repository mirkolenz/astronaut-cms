import { envField } from "astro/config";
import type { CmsConfig } from "./types.ts";
import { isByok } from "./resolve-config.ts";
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
import { gatewayEnv } from "../shared/ai.ts";

type SecretField = ReturnType<typeof envField.string>;

/**
 * The secrets the injected routes read, declared through `astro:env` so the site
 * types them without declaring anything itself. Every one is optional: a host
 * that injects secrets only at runtime (Workers, Netlify, Vercel) has none at
 * build time, so a build with `validateSecrets` must not demand them, and the
 * route names a missing one on the request that needs it.
 */
export function secretsSchema(config: CmsConfig): Record<string, SecretField> {
  const names: string[] = [];
  const provider = config.storage?.type;

  if (provider === "github" || provider === "gitlab") {
    names.push(
      provider === "github" ? GITHUB_CLIENT_SECRET_ENV : GITLAB_CLIENT_SECRET_ENV,
      SESSION_SECRET_ENV,
    );
  }

  if ((config.media?.backend?.type ?? "repo") !== "repo") {
    names.push(S3_ACCESS_KEY_ID_ENV, S3_SECRET_ACCESS_KEY_ENV, S3_SESSION_TOKEN_ENV);
  }

  // Only the relay reads a gateway credential, and there is none under `byok`.
  if (config.ai?.enabled && config.ai.gateway && !isByok(config)) {
    names.push(...gatewayEnv(config.ai.gateway));
  }

  return Object.fromEntries(
    names.map((name) => [
      name,
      envField.string({ context: "server", access: "secret", optional: true }),
    ]),
  );
}
