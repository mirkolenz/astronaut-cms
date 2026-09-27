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
  /**
   * Module specifiers to stub in client builds. These modules are replaced
   * with no-op exports so their Node.js dependencies don't enter the browser
   * bundle. Useful for third-party content collection loaders.
   *
   * When set, replaces the defaults (`["@astrojs/starlight/loaders"]`).
   */
  clientStubs?: string[];
}

export type SupportedLocale = "en" | "de";

export type PublishMode = "direct" | "pull-request";

export type StorageConfig =
  | { type: "local" }
  | {
      type: "github";
      repo: string;
      branch?: string;
      clientId: string;
      publishMode?: PublishMode;
    }
  | {
      type: "gitlab";
      project: string;
      branch?: string;
      clientId: string;
      instanceUrl?: string;
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
    publishMode: PublishMode;
  };
  gitlab?: {
    project: string;
    branch: string;
    clientId: string;
    instanceUrl: string;
    publishMode: PublishMode;
  };
}
