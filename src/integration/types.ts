export interface CmsConfig {
  /** Path to the CMS config file, relative to the project root (default: auto-discovered from src/cms.config.{ts,mts,js,mjs}) */
  config?: string;
  /** Mount point for the admin panel (default: "/admin") */
  mountPoint?: string;
  /** Storage backend configuration */
  storage?: StorageConfig;
  /** Substitute the local filesystem backend during `astro dev`, even when a remote storage is configured (default: true) */
  localStorageInDev?: boolean;
  /** Media file configuration */
  media?: MediaConfig;
  /** Admin panel language (default: "en") */
  locale?: SupportedLocale;
  /**
   * URL pattern for branch previews from your hosting provider. Supports two
   * placeholders: `{branch}` (raw branch, e.g. `cms/alice`) and `{slug}`
   * (lowercased with non-alphanumerics replaced by `-`, e.g. `cms-alice`).
   *
   * Examples:
   * - Netlify: `https://{slug}--my-site.netlify.app`
   * - Cloudflare: `https://{slug}-my-worker.my-account.workers.dev`
   * - Vercel: `https://my-site-git-{slug}-team.vercel.app`
   */
  previewUrl?: string;
}

export type SupportedLocale = "en" | "de";

export type PublishMode = "direct" | "pull-request";

/**
 * GitHub authentication strategy.
 *
 * - `oauth-app`: classic OAuth App. Tokens carry coarse scopes (see `scopes`)
 *   and cannot be limited to a single repository.
 * - `github-app`: GitHub App. Tokens are limited to the repositories the app is
 *   installed on and the permissions it declares (use Contents + Pull requests),
 *   and can be configured to expire. Strongly recommended for least privilege.
 */
export type GitHubAuthMode = "oauth-app" | "github-app";

export type StorageConfig =
  | { type: "local" }
  | {
      type: "github";
      repo: string;
      branch?: string;
      clientId: string;
      /** Authentication strategy (default: "oauth-app"). */
      authMode?: GitHubAuthMode;
      /**
       * OAuth scopes for `oauth-app` mode (default: `["repo"]`). Use
       * `["public_repo"]` for public-only repositories. Ignored for
       * `github-app` mode, where permissions come from the app itself.
       */
      scopes?: string[];
      publishMode?: PublishMode;
    }
  | {
      type: "gitlab";
      project: string;
      branch?: string;
      clientId: string;
      instanceUrl?: string;
      /**
       * OAuth scopes (default: `["api"]`). Note that GitLab's API-based writes
       * (commits, merge requests) require `api`; the narrower `write_repository`
       * scope only covers Git-over-HTTP and is insufficient here.
       */
      scopes?: string[];
      publishMode?: PublishMode;
    };

export interface MediaConfig {
  directory?: string;
  allowedExtensions?: string[];
  maxFileSize?: number;
}

export interface CmsClientConfig {
  mountPoint: string;
  storageType: "local" | "github" | "gitlab";
  mediaDirectory: string;
  locale: SupportedLocale;
  previewUrl?: string;
  github?: {
    repo: string;
    branch: string;
    clientId: string;
    authMode: GitHubAuthMode;
    scopes: string[];
    publishMode: PublishMode;
  };
  gitlab?: {
    project: string;
    branch: string;
    clientId: string;
    instanceUrl: string;
    scopes: string[];
    publishMode: PublishMode;
  };
}
