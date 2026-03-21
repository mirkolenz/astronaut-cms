export interface CmsConfig {
  /** Path to the CMS config file, relative to the project root (default: auto-discovered from src/cms.config.{ts,mts,js,mjs}) */
  config?: string;
  /** Mount point for the admin panel (default: "/admin") */
  mountPoint?: string;
  /** Storage backend configuration */
  storage?: StorageConfig;
  /** Media file configuration */
  media?: MediaConfig;
  /** Admin panel language (default: "en") */
  locale?: SupportedLocale;
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

export type StorageConfig =
  | { type: "local" }
  | {
      type: "github";
      repo: string;
      branch?: string;
      clientId: string;
      publishMode?: "direct" | "pull-request";
    }
  | {
      type: "gitlab";
      project: string;
      branch?: string;
      clientId: string;
      instanceUrl?: string;
      publishMode?: "direct" | "merge-request";
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
  github?: {
    repo: string;
    branch: string;
    clientId: string;
  };
  gitlab?: {
    project: string;
    branch: string;
    clientId: string;
    instanceUrl: string;
  };
}
