import type { ContentI18n } from "../shared/i18n.ts";
import type { ClientMediaConfig, S3Target } from "../shared/media.ts";
import type { AiCredentials, AiGateway, GatewayEndpoint } from "../shared/ai.ts";
import type { CollectionManifest } from "../shared/types.ts";

export type { AiGateway };

export interface CmsConfig {
  /** Path to the CMS config file, relative to the project root (default: auto-discovered from src/cms.config.{ts,tsx,mts,js,jsx,mjs}) */
  config?: string;
  /** Mount point for the admin panel (default: "/admin") */
  mountPoint?: string;
  /** Ship the admin and its API in `astro build`, `astro dev` always serves them (default: true for a Git backend, false for local storage) */
  admin?: boolean;
  /** Storage backend configuration */
  storage?: StorageConfig;
  /** Substitute the local filesystem backend during `astro dev`, even when a remote storage is configured (default: true) */
  localStorageInDev?: boolean;
  /** The media libraries, see {@link MediaConfig}. */
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
 * Agentic AI assistant. The browser runs the agent loop, but every tool it calls
 * is one operation on the CMS server, so the model reaches exactly what the UI
 * reaches and no further. Only raw model inference is proxied, through a
 * stateless relay that adds the gateway credential. One request per model call,
 * so no serverless duration limit can cut a turn in half.
 */
export interface AiConfig {
  /** Enable the assistant and inject the relay route (default: false). */
  enabled?: boolean;
  /** AI gateway. Its credential comes from the environment, see {@link AiGateway}. */
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

/**
 * The media libraries. The repository library is always there, and an object
 * store can be configured beside it, each with its own entry in the admin's
 * sidebar. Each one decides for itself what it takes: extensions and size bounds
 * say what an editor may upload where, e.g. SVG logos into the repository and
 * photos into the store. Bounds may overlap, since the editor picks the library
 * and the bounds only refuse what does not belong there.
 */
export interface MediaConfig {
  /** The library in the repository, which content and media publish together from. */
  repo?: RepoMediaConfig;
  /** An object store beside it. See {@link S3MediaConfig}. */
  s3?: S3MediaConfig;
}

/** What every library takes. */
interface MediaLibraryConfig {
  /** The library's name in the admin, overriding the translated default. */
  label?: string;
  /** Restricts the library to these extensions (e.g. `[".svg", ".png"]`). Any file is accepted when unset. */
  allowedExtensions?: string[];
  /**
   * How the browser reshapes an image before it is uploaded here. Enabled with
   * the defaults of {@link ImageOptimizationConfig}; pass `false` to upload
   * every original untouched.
   */
  optimizeImages?: ImageOptimizationConfig | false;
  /**
   * Smallest file the library accepts, in bytes. Checked against the upload as
   * it is sent, so after image optimization where that is enabled.
   */
  minFileSize?: number;
  /** Largest file the library accepts, in bytes, checked like {@link minFileSize}. */
  maxFileSize?: number;
}

/**
 * The repository library. Uploads join the pending changeset and publish with
 * it, and astro's asset pipeline optimizes and bundles what content references.
 *
 * Its uploads pass through the CMS route, which holds each one in memory before
 * committing it, so `maxFileSize` is also that route's body limit. Keep it
 * within the host's own request limit (e.g. 4.5 MB on Vercel).
 */
export interface RepoMediaConfig extends MediaLibraryConfig {
  /** Repository directory holding the library (default: "src/assets"). */
  directory?: string;
  /**
   * Whether a build deletes the library files no delivered page, stylesheet or
   * script names, where their source is known. By default it keeps the library
   * when on-demand code can reach content or library media, since that code may
   * link any file at request time. `true` prunes regardless.
   */
  prune?: boolean;
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
 * An object store, addressed through its S3 API. Uploads go straight from the
 * browser to the bucket and take effect immediately rather than joining the
 * changeset. Content stores each file's public URL, which astro optimizes as a
 * remote image at build time (the integration authorizes `publicUrl` for it),
 * so visitors are served the optimized variants rather than the originals.
 *
 * It needs the injected media route, and therefore an SSR adapter, because no
 * bucket credential may ever reach the browser. Credentials come exclusively
 * from that route's environment: `ASTRONAUT_CMS_S3_ACCESS_KEY_ID`,
 * `ASTRONAUT_CMS_S3_SECRET_ACCESS_KEY` and optionally
 * `ASTRONAUT_CMS_S3_SESSION_TOKEN`.
 */
export type S3MediaConfig = S3EndpointMediaConfig | R2MediaConfig;

interface ObjectStoreConfig extends MediaLibraryConfig {
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
  /**
   * Where `astro dev` keeps the library instead of the bucket, relative to the
   * project root (default: ".astronaut-cms/s3"). Without it, editing in dev
   * uploads to, and deletes from, the same bucket the deployed site serves.
   * Pass `false` to edit the bucket from dev anyway.
   *
   * Only the bytes move: a reference is still written as the store's URL, so an
   * entry edited in dev builds unchanged. Needs local storage, since the files
   * are reached through the dev server's own file API.
   */
  devDirectory?: string | false;
}

/** Any S3-compatible object store (AWS S3, MinIO, Backblaze B2, Hetzner, ...). */
export interface S3EndpointMediaConfig extends ObjectStoreConfig {
  provider?: "s3";
  /** API endpoint, e.g. `https://s3.eu-central-1.amazonaws.com`. */
  endpoint: string;
  /** Signing region (default: inferred from `endpoint` on AWS, R2 and B2, falling back to "us-east-1"). */
  region?: string;
  /** Address objects as `<endpoint>/<bucket>/<key>` rather than by virtual host. */
  forcePathStyle?: boolean;
}

/**
 * Cloudflare R2 through its S3 API. Renames and deletions are copies inside
 * R2, so file size is bounded by R2 alone.
 *
 * Public serving needs a custom domain on the bucket: the `*.r2.dev` hostname is
 * rate-limited and not meant for production traffic.
 */
export interface R2MediaConfig extends ObjectStoreConfig {
  provider: "r2";
  /** Cloudflare account id, for the S3 API endpoint. */
  accountId: string;
}

/**
 * What the injected media route needs to reach the store. Server-only: it is
 * imported by the route alone, so a bucket name or endpoint never reaches the
 * admin bundle.
 */
export interface MediaServerConfig {
  /** Where the library's keys are served, which is where a read is sent. */
  publicUrl: string;
  /** Normalized to "" or "prefix/". */
  prefix: string;
  /** The store's S3 API. */
  s3: S3Target;
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
export interface CmsServerConfig {
  /** The site's `trailingSlash` policy, which the CMS's own URLs have to follow for Astro to match them. */
  trailingSlash: "always" | "never" | "ignore";
  storage: ServerStorageConfig;
  /** The object store, null when there is none or a dev run keeps it in the working tree. */
  media: MediaServerConfig | null;
  /** Null when the assistant is disabled. */
  ai: AiServerConfig | null;
}

export interface CmsClientConfig {
  mountPoint: string;
  storageType: "local" | "github" | "gitlab";
  /** The media libraries, minus everything only the server may know. */
  media: ClientMediaConfig;
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
  collections: CollectionManifest;
}
