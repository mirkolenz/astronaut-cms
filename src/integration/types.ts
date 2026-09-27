import type { ContentI18n } from "../shared/i18n.ts";

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
  directory?: string;
  allowedExtensions?: string[];
  maxFileSize?: number;
  /**
   * Glob patterns, relative to `directory`, for files to bundle even when no
   * content references them (e.g. `["og/**", "brand/logo.svg"]`).
   *
   * A production build only emits the assets it can reach from content, so a
   * path that appears solely in site code — `resolveImage("/src/assets/og.png")`
   * in a layout, say — has to be listed here.
   */
  alwaysInclude?: string[];
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
