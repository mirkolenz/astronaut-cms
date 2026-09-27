import type { ContentI18n } from "../shared/i18n.ts";
import type { ClientMediaBackend } from "../shared/media.ts";

export interface CmsConfig {
  /** Path to the CMS config file, relative to the project root (default: auto-discovered from src/cms.config.{ts,mts,js,mjs}) */
  config?: string;
  /** Mount point for the admin panel (default: "/admin") */
  mountPoint?: string;
  /** Storage backend configuration */
  storage?: StorageConfig;
  /** Substitute the local filesystem backend during `astro dev`, even when a remote storage is configured (default: true) */
  localStorageInDev?: boolean;
  /**
   * Keep the media library in the working tree during `astro dev`, even when an
   * object store is configured (default: true). Without it, editing in dev
   * uploads to — and deletes from — the same bucket the deployed site serves.
   *
   * Only the bytes move: an asset reference is still written as the store's key,
   * so an entry edited in dev builds unchanged. Needs local storage, since the
   * files are reached through the dev server's own file API.
   */
  localMediaInDev?: boolean;
  /** Media file configuration */
  media?: MediaConfig;
  /** Admin panel language, and the default for its language switcher (default: "en") */
  locale?: SupportedLocale;
  /**
   * Multilingual content. Defaults to the site's own `i18n` setting in
   * `astro.config`, so a site that already declares `locales` and `defaultLocale`
   * needs nothing here.
   *
   * With it in effect, a collection whose entries all sit in locale directories
   * (`src/content/posts/en/…`, `src/content/posts/de/…` — the layout Astro's i18n
   * recipe recommends) is edited language by language, with missing translations
   * surfaced in the listing. Pass `false` to keep the admin locale-agnostic and
   * treat those directories as ordinary folders.
   */
  i18n?: { locales?: string[]; defaultLocale?: string } | false;
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
  /** Agentic AI assistant configuration */
  ai?: AiConfig;
}

/**
 * AI gateway, selected statically in the config. Only non-secret structure lives
 * here. Credentials come exclusively from the environment, so an API key can
 * never be committed:
 *
 * - `netlify` / `vercel`: the platform injects credentials automatically, so the
 *   bare `{ type }` is enough on those hosts.
 * - `cloudflare`: provide `accountId` (and optionally `gatewayId`). A Cloudflare
 *   API token with AI Gateway permission comes from the `CLOUDFLARE_API_TOKEN`
 *   environment variable.
 * - `custom`: any OpenAI-compatible gateway via `baseUrl`. The key comes from the
 *   `ASTRONAUT_CMS_AI_API_KEY` environment variable.
 */
export type AiGateway =
  | { type: "netlify" }
  | { type: "vercel" }
  | { type: "cloudflare"; accountId: string; gatewayId?: string }
  | { type: "custom"; baseUrl: string };

/**
 * Agentic AI assistant. The browser runs the agent loop and executes content
 * tools with the user's Git token; only raw model inference is proxied through
 * an injected, stateless relay that adds the gateway credential and gates access
 * by re-validating that same token. Everything is declared statically here.
 */
export interface AiConfig {
  /** Enable the assistant and inject the relay route (default: false). */
  enabled?: boolean;
  /** AI gateway and (optional) credentials. See {@link AiGateway}. */
  gateway: AiGateway;
  /**
   * Gateway-qualified model ids the assistant may use (e.g.
   * `"anthropic/claude-opus-4.7"`). The first entry is the default; the relay
   * rejects any model not in this list.
   */
  models: string[];
  /** Maximum model/tool round-trips per turn (default: 24). */
  maxSteps?: number;
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

/**
 * How the editor signs in to GitHub.
 *
 * - `device`: the device flow. Entirely browser-side — no server route, no
 *   client secret — but the editor has to copy a code to github.com by hand,
 *   every time and in every new tab.
 * - `redirect`: the ordinary browser redirect, with PKCE. GitHub demands a
 *   client secret to redeem the authorization code even so (it does not
 *   distinguish public clients), so this injects a token-exchange route that
 *   holds the secret in `ASTRONAUT_CMS_GITHUB_CLIENT_SECRET` and therefore needs
 *   an SSR adapter. After the first consent GitHub approves the redirect without
 *   a prompt, which makes signing in a round-trip the editor barely sees — worth
 *   it in particular when an access proxy (Cloudflare Access, Vercel Passport)
 *   already signed them in with the same identity provider.
 */
export type GitHubLoginFlow = "device" | "redirect";

export type StorageConfig =
  | { type: "local" }
  | {
      type: "github";
      repo: string;
      branch?: string;
      clientId: string;
      /** Authentication strategy (default: "oauth-app"). */
      authMode?: GitHubAuthMode;
      /** Sign-in flow (default: "device"). See {@link GitHubLoginFlow}. */
      flow?: GitHubLoginFlow;
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
  /** Repository directory holding the library. `repo` backend only (default: "src/assets"). */
  directory?: string;
  allowedExtensions?: string[];
  maxFileSize?: number;
  /**
   * Glob patterns, relative to `directory`, for files to bundle even when no
   * content references them (e.g. `["og/**", "brand/logo.svg"]`).
   *
   * A production build only emits the assets it can reach from content, so a
   * path that appears solely in site code — `resolveImage("/src/assets/og.png")`
   * in a layout, say — has to be listed here. `repo` backend only: an object
   * store is never bundled.
   */
  alwaysInclude?: string[];
  /** Where the library's files live (default: `{ type: "repo" }`). */
  backend?: MediaBackendConfig;
}

/**
 * Where the media library stores its files.
 *
 * - `repo`: in the repository, alongside content. Uploads join the pending
 *   changeset and publish with it, and astro's asset pipeline optimizes and
 *   bundles what content references.
 * - `s3` / `r2`: in an object store, addressed by key. Uploads take effect
 *   immediately rather than joining the changeset, content stores library keys
 *   instead of project paths, and the site loads them from `publicUrl` (astro
 *   optimizes them as remote images, which the integration authorizes for you).
 *
 * An object store needs the injected media route, and therefore an SSR adapter,
 * because no bucket credential may ever reach the browser. The bucket must be
 * publicly readable under `publicUrl`: what content stores is a plain key, so a
 * signed, expiring URL is never written into an entry.
 */
export type MediaBackendConfig = { type: "repo" } | S3MediaConfig | R2MediaConfig;

interface ObjectStoreConfig {
  /** Bucket holding the library. */
  bucket: string;
  /** Key prefix the library is rooted at, e.g. "media" (default: the bucket root). */
  prefix?: string;
  /**
   * Public base URL the library's keys are served under, e.g.
   * `https://cdn.example.com`. It must serve the same `prefix` root, since a
   * key is appended to it verbatim.
   */
  publicUrl: string;
}

/**
 * Any S3-compatible object store (AWS S3, MinIO, Backblaze B2, Hetzner, …).
 * Credentials come exclusively from the environment of the injected route:
 * `ASTRONAUT_CMS_S3_ACCESS_KEY_ID`, `ASTRONAUT_CMS_S3_SECRET_ACCESS_KEY` and
 * optionally `ASTRONAUT_CMS_S3_SESSION_TOKEN`.
 */
export interface S3MediaConfig extends ObjectStoreConfig {
  type: "s3";
  /** API endpoint, e.g. `https://s3.eu-central-1.amazonaws.com`. */
  endpoint: string;
  /** Signing region (default: "auto"). */
  region?: string;
  /** Address objects as `<endpoint>/<bucket>/<key>` rather than by virtual host. */
  forcePathStyle?: boolean;
}

/**
 * Cloudflare R2, which speaks the S3 API. Reached either through that API with
 * `accountId` and the `ASTRONAUT_CMS_S3_*` credentials, or — when the site is
 * deployed with `@astrojs/cloudflare` — through a Workers `binding`, which needs
 * no credentials at all. A binding proxies uploads through the Worker, where the
 * S3 API hands the browser a presigned URL and never sees the bytes.
 *
 * Public serving needs a custom domain on the bucket: the `*.r2.dev` hostname is
 * rate-limited and not meant for production traffic.
 */
export interface R2MediaConfig extends ObjectStoreConfig {
  type: "r2";
  /** Cloudflare account id, for the S3 API endpoint. Required without `binding`. */
  accountId?: string;
  /** Workers R2 binding name, e.g. "MEDIA". Preferred when it is available. */
  binding?: string;
}

/**
 * What the injected media route needs to reach the store. Server-only: it is
 * imported by the route alone, so a bucket name or endpoint never reaches the
 * admin bundle.
 */
export interface MediaServerConfig {
  bucket: string;
  /** Normalized to "" or "prefix/". */
  prefix: string;
  /** S3 API access. Absent only for a binding-only R2 backend. */
  s3: { endpoint: string; region: string; pathStyle: boolean } | null;
  /** Workers R2 binding name, when one is configured. */
  binding: string | null;
}

export interface CmsClientConfig {
  mountPoint: string;
  storageType: "local" | "github" | "gitlab";
  // The host site's Astro `trailingSlash` policy, so the client can address the
  // injected relay route (an API endpoint) in the form Astro will actually match.
  trailingSlash: "always" | "never" | "ignore";
  mediaDirectory: string;
  /** File extensions the media library lists, e.g. [".png", ".pdf"]. */
  mediaExtensions: string[];
  /** Upload size limit in bytes, or null for unlimited. */
  maxFileSize: number | null;
  /** `media.alwaysInclude` globs, so the admin knows which files site code reaches. */
  mediaAlwaysInclude: string[];
  /** Where the library's files live, minus everything only the server may know. */
  mediaBackend: ClientMediaBackend;
  /** Default admin panel UI language. Distinct from `contentI18n`, which is about the site's content. */
  locale: SupportedLocale;
  /** The site's content languages, or null when it is single-language. */
  contentI18n: ContentI18n | null;
  previewUrl?: string;
  ai?: {
    models: string[];
    maxSteps: number;
  };
  github?: {
    repo: string;
    branch: string;
    clientId: string;
    flow: GitHubLoginFlow;
    /** Empty when the scope parameter does not apply, i.e. for `github-app`. */
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
