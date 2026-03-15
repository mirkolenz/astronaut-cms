export interface CmsConfig {
  /** Path to the CMS config file, relative to the project root (default: auto-discovered from src/cms.config.{ts,mts,js,mjs}) */
  config?: string;
  /** Mount point for the admin panel (default: "/admin") */
  mountPoint?: string;
  /** Storage backend configuration */
  storage?: StorageConfig;
  /** Media file configuration */
  media?: MediaConfig;
}

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
