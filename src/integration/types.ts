import type { ContentI18n } from "../shared/i18n.ts";
import type { ClientMediaBackend } from "../shared/media.ts";
import type { AiCredentials, AiGateway, GatewayEndpoint } from "../shared/ai.ts";
import type { CollectionSort } from "../shared/types.ts";

export type { AiGateway };

export interface CmsConfig {
  /** Path to the CMS config file, relative to the project root (default: auto-discovered from src/cms.config.{ts,mts,js,mjs}) */
  config?: string;
  /** Mount point for the admin panel (default: "/admin") */
  mountPoint?: string;
  /** Storage backend configuration */
  storage?: StorageConfig;
  /** Options per collection of `content.config`, keyed by collection name. */
  collections?: Record<string, CollectionOptions>;
  /**
   * Where the injected routes read secrets and Workers bindings from. Detected
   * from the Astro adapter, so set it only for an adapter that wraps or forks a
   * supported one under a name the detection does not recognise.
   */
  runtime?: CmsRuntime;
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
  /** Expose the CMS to agents running in the editor's browser. See {@link WebmcpConfig}. */
  webmcp?: WebmcpConfig;
}

export type { CollectionSort };

export interface CollectionOptions {
  /**
   * How entries are ordered, both in the admin and for the site through
   * `sortEntries` from `astronaut-cms/content` (default: "id", astro's own
   * order). "file" keeps the order of a `file()` collection's file, which
   * editors can then change.
   */
  sort?: CollectionSort;
}

/**
 * WebMCP: the admin hands an agent running in the editor's own browser the same
 * tools the built-in assistant uses, through `document.modelContext`, instead of
 * a page to scrape. The agent is the editor's — the browser's own, or one they
 * installed — so it spends no credential of this deployment's and reaches the
 * CMS through the editor's session and nothing else.
 *
 * Everything that bounds the built-in assistant bounds it too: each tool is one
 * operation on the CMS server, nothing publishes, a write joins the pending
 * changeset for a human to review, and the server refuses to remove or move a
 * file content still references. What is genuinely new is that the agent is not
 * one this project wrote, which is why it is off unless you turn it on.
 */
export interface WebmcpConfig {
  /** Expose the tools to agents in the browser (default: false). */
  enabled?: boolean;
  /**
   * Chrome origin trial token for this deployment's origin, served as the
   * `Origin-Trial` header on the admin page.
   *
   * WebMCP is an origin trial through Chrome 156, so without a token the API is
   * simply absent and nothing is exposed. Register the origin at
   * https://developer.chrome.com/origintrials; for local development enable
   * `chrome://flags/#enable-webmcp-testing` instead. Drop this once the API
   * ships unflagged.
   */
  originTrialToken?: string;
}

/**
 * AI gateway, selected statically in the config. Only non-secret structure lives
 * here. Credentials come exclusively from the environment, so an API key can
 * never be committed:
 *
 * - `netlify` / `vercel`: the platform injects credentials automatically, so the
/**
 * Agentic AI assistant. The browser runs the agent loop, but every tool it calls
 * is one operation on the CMS server, so the model reaches exactly what the UI
 * reaches and no further. Only raw model inference is proxied, through a
 * stateless relay that adds the gateway credential. One request per model call,
 * so no serverless duration limit can cut a turn in half.
 */
export interface AiConfig {
  /** Enable the assistant and inject the relay route (default: false). */
  enabled?: boolean;
  /** AI gateway and (optional) credentials. See {@link AiGateway}. */
  gateway: AiGateway;
  /**
   * Whose credential the assistant spends (default: `"relay"`).
   *
   * `"byok"` asks each editor for their own key, which stays in their browser
   * and goes straight to the gateway: no relay route, no function invocations
   * for inference, and no shared budget anyone can drain. In exchange the
   * deployment enforces none of {@link AiLimits} or the model allowlist, because
   * nothing of the deployment's is at stake. Needs a gateway a browser can
   * address, so `cloudflare` or `custom` rather than the platform-injected ones.
   *
   * See {@link AiCredentials}.
   */
  credentials?: AiCredentials;
  /**
   * Gateway-qualified model ids the assistant may use (e.g.
   * `"anthropic/claude-opus-4.7"`). The first entry is the default; the relay
   * rejects any model not in this list.
   */
  models: string[];
  /** Maximum model/tool round-trips per turn (default: 24). */
  maxSteps?: number;
  /** Abuse controls applied by the relay. See {@link AiLimits}. */
  limits?: AiLimits;
}

/**
 * How large one request through the relay may be. The relay holds the gateway
 * credential, so without these an editor's session is a licence to bill the
 * site's account through one enormous request or one unbounded completion.
 *
 * How *often* an editor may call is not here: a turn is up to `maxSteps` relay
 * requests, so the rate ceiling is derived from that rather than configured
 * beside it (see `ai/handler.ts`). Both bind one warm instance rather than the
 * deployment (see `RateLimiter`), so treat them as a brake rather than a budget
 * and set a spending cap at the gateway as well.
 */
export interface AiLimits {
  /** Largest request body the relay forwards, in bytes (default: 1 MiB). */
  maxRequestBytes?: number;
  /** Ceiling clamped onto the request's `max_tokens` (default: 8192). */
  maxOutputTokens?: number;
}

/**
 * Server-only AI config: which gateway to reach and what to allow through it.
 * Imported by the relay route alone, like {@link MediaServerConfig}.
 */
export interface AiServerConfig {
  gateway: AiGateway;
  /** Resolved {@link AiConfig.maxSteps}. The relay's rate ceiling follows from it. */
  maxSteps: number;
  limits: Required<AiLimits>;
}

export type SupportedLocale = "en" | "de";

export type PublishMode = "direct" | "pull-request";

export type StorageConfig =
  | { type: "local" }
  | {
      /**
       * A GitHub App, which is the only GitHub authentication the CMS accepts.
       * Register one, install it on the repository with Contents and Pull
       * requests write permission, and set its client id here and its client
       * secret in `ASTRONAUT_CMS_GITHUB_CLIENT_SECRET`.
       *
       * A classic OAuth App is deliberately unsupported: the token it issues is
       * coarse, covers every repository the editor can reach, and never expires,
       * which is a poor thing for a deployment to hold on an editor's behalf.
       * A GitHub App issues a token limited to the installation that expires in
       * hours and refreshes itself.
       */
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
  /** Restricts the library to these extensions (e.g. `[".png", ".pdf"]`). Any file is accepted when unset. */
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
  /**
   * How the browser reshapes an image before it is uploaded. Enabled with the
   * defaults of {@link ImageOptimizationConfig}; pass `false` to upload every
   * original untouched.
   */
  optimizeImages?: ImageOptimizationConfig | false;
}

/** The formats a browser canvas can encode to, and therefore convert into. */
export type ImageOutputFormat = "jpeg" | "png" | "webp" | "avif";

/**
 * Client-side image processing, applied to every upload the browser can decode
 * (JPEG, PNG, WebP, AVIF). SVG, GIF and non-images are never touched, and an
 * image already inside every limit is passed through as its original bytes
 * rather than re-encoded.
 *
 * It is a guard against the 12 MP phone original, not a substitute for astro's
 * asset pipeline: the library keeps one sensible master, and the build still
 * derives the per-breakpoint variants a page actually serves.
 */
export interface ImageOptimizationConfig {
  /** Widest an upload may be, in pixels. Wider ones are scaled down, aspect ratio intact (default: 2048). */
  maxWidth?: number;
  /** Tallest an upload may be, in pixels (default: 2048). */
  maxHeight?: number;
  /**
   * Size in bytes above which an image is re-encoded even when its dimensions
   * already fit (default: 8 MiB). Quality steps down from `quality` towards
   * `minQuality` until the result fits, so this is a threshold rather than a
   * guarantee: an image that will not compress that far is uploaded at
   * `minQuality`. Lossless PNG output ignores it entirely.
   */
  maxFileSize?: number;
  /**
   * Convert every upload into this format, e.g. `"webp"` to keep the library in
   * one modern format. Omitted, each image keeps the format it arrived in.
   * `"avif"` falls back to the original in browsers that cannot encode it.
   */
  format?: ImageOutputFormat;
  /** Encoder quality for lossy formats, between 0 and 1 (default: 0.92). */
  quality?: number;
  /** Lowest quality the `maxFileSize` ladder descends to (default: 0.5). */
  minQuality?: number;
}

/** {@link ImageOptimizationConfig} with every default filled in. */
export type ResolvedImageOptimization = Required<Omit<ImageOptimizationConfig, "format">> & {
  /** Null when uploads keep their own format. */
  format: ImageOutputFormat | null;
};

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
 * because no bucket credential may ever reach the browser. What content stores
 * is always a plain key, never a signed URL that would expire inside an entry;
 * `publicUrl` is where those keys are served from.
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
   *
   * A CDN that holds the bucket credential itself (CloudFront with an origin
   * access control, an R2 custom domain) is a public base as far as this is
   * concerned: set it to the CDN and the bucket stays closed.
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
 * Cloudflare R2, reached in exactly one of two ways.
 *
 * - `accountId`: the S3 API, with the `ASTRONAUT_CMS_S3_*` credentials. Uploads
 *   go straight from the browser to the bucket, and renames and deletions are
 *   copies inside R2, so file size is bounded by R2 alone.
 * - `binding`: a Workers binding on `@astrojs/cloudflare`, which needs no
 *   credential and never loads the AWS SDK. Uploads, renames and deletions pass
 *   through the Worker instead, so an upload is bounded by the plan's request
 *   body limit.
 *
 * Public serving needs a custom domain on the bucket: the `*.r2.dev` hostname is
 * rate-limited and not meant for production traffic.
 */
export type R2MediaConfig = ObjectStoreConfig & { type: "r2" } & (
    | {
        /** Cloudflare account id, for the S3 API endpoint. */
        accountId: string;
        binding?: never;
      }
    | {
        /** Workers R2 binding name, e.g. "MEDIA". */
        binding: string;
        accountId?: never;
      }
  );

/**
 * What the injected media route needs to reach the store. Server-only: it is
 * imported by the route alone, so a bucket name or endpoint never reaches the
 * admin bundle.
 */
export interface MediaServerConfig {
  bucket: string;
  /** Where the library's keys are served, which is where a read is sent. */
  publicUrl: string;
  /** Normalized to "" or "prefix/". */
  prefix: string;
  /** How the store is reached: its S3 API, or a Workers R2 binding. */
  access:
    | { type: "s3"; endpoint: string; region: string; pathStyle: boolean }
    | { type: "binding"; name: string };
}

/**
 * Storage as the server resolves it: fully defaulted, and carrying what no
 * browser may see. The `local` variant exists only for `astro dev`.
 */
export type ServerStorageConfig =
  | { type: "local"; rootDir: string }
  | {
      type: "github";
      owner: string;
      repo: string;
      branch: string;
      clientId: string;
      publishMode: PublishMode;
    }
  | {
      type: "gitlab";
      project: string;
      branch: string;
      instanceUrl: string;
      clientId: string;
      scopes: string[];
      publishMode: PublishMode;
    };

/**
 * Everything the injected route needs and the admin bundle must never hold: the
 * repository credential's identity, the object store's endpoint and bucket, the
 * AI gateway. Imported solely by `server/`, so it is bundled into the SSR output
 * alone.
 */
/**
 * Where the injected routes read secrets and bindings from. Detected from the
 * Astro adapter; set it only for an adapter that wraps or forks a supported one
 * under a name the detection does not recognise.
 */
export type CmsRuntime = "cloudflare" | "node";

export interface CmsServerConfig {
  storage: ServerStorageConfig;
  /** Null when the media library lives in the repository. */
  media: MediaServerConfig | null;
  /** Null when the assistant is disabled. */
  ai: AiServerConfig | null;
  mediaDirectory: string;
  /** Null when the library accepts any file. */
  mediaExtensions: string[] | null;
  maxFileSize: number | null;
}

export interface CmsClientConfig {
  mountPoint: string;
  storageType: "local" | "github" | "gitlab";
  // The host site's Astro `trailingSlash` policy, so the client can address the
  // injected relay route (an API endpoint) in the form Astro will actually match.
  trailingSlash: "always" | "never" | "ignore";
  mediaDirectory: string;
  /** File extensions the media library lists, e.g. [".png", ".pdf"], or null for any file. */
  mediaExtensions: string[] | null;
  /** Upload size limit in bytes, or null for unlimited. */
  maxFileSize: number | null;
  /** `media.alwaysInclude` globs, so the admin knows which files site code reaches. */
  mediaAlwaysInclude: string[];
  /** Where the library's files live, minus everything only the server may know. */
  mediaBackend: ClientMediaBackend;
  /** How to reshape an image before uploading it, or null when uploads go untouched. */
  imageOptimization: ResolvedImageOptimization | null;
  /** Default admin panel UI language. Distinct from `contentI18n`, which is about the site's content. */
  locale: SupportedLocale;
  /** The site's content languages, or null when it is single-language. */
  contentI18n: ContentI18n | null;
  previewUrl?: string;
  ai?: {
    models: string[];
    maxSteps: number;
    /**
     * Set when the editor brings their own key: where the browser sends
     * inference, since it no longer goes through this deployment at all.
     */
    byok?: GatewayEndpoint;
  };
  /** What the changeset UI may offer, decided by the backend rather than the UI. */
  capabilities: { publish: boolean; update: boolean };
  /** Present exactly when the tools are exposed to agents in the browser. */
  webmcp?: { originTrialToken?: string };
}
