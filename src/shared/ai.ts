import { API_BASE } from "./auth.ts";

/**
 * The AI relay, as the browser addresses it. It sits under the CMS API so one
 * injected route covers everything and one session cookie authenticates it; the
 * browser talks to it as an OpenAI-compatible endpoint, so the provider appends
 * `/chat/completions` itself.
 */
export const AI_API_BASE = `${API_BASE}/ai`;

/** The key of a `custom` gateway, optional since a local model server needs none. */
export const AI_API_KEY_ENV = "ASTRONAUT_CMS_AI_API_KEY";

/** Default maximum model/tool round-trips per assistant turn. */
export const DEFAULT_AI_MAX_STEPS = 24;

/**
 * Where the credential the assistant spends comes from.
 *
 * - `relay`: the deployment's, held on the server. Every model call is proxied,
 *   so the deployment enforces the model allowlist, the output ceiling and the
 *   per-editor rate, and pays for the invocation it is held open for.
 * - `byok`: the editor's own, kept in their browser and sent straight to the
 *   gateway. No relay, no invocation, no shared budget to drain. The deployment
 *   enforces nothing, because nothing of the deployment's is being spent.
 *
 * The deployment's own key is never a candidate for the browser. Handing it out
 * would make a shared, non-expiring, unscoped credential readable by any script
 * on the admin origin, and would bypass every limit the relay exists to apply.
 */
export type AiCredentials = "relay" | "byok";

/**
 * Which gateway to reach, and where its credential comes from.
 *
 * - `netlify` / `vercel`: the platform injects both the base URL and the key, so
 *   a bare `{ type }` is enough on those hosts.
 * - `cloudflare`: provide `accountId` (and optionally `gatewayId`). A Cloudflare
 *   API token with AI Gateway permission comes from the `CLOUDFLARE_API_TOKEN`
 *   environment variable.
 * - `custom`: any OpenAI-compatible gateway via `baseUrl`. The key comes from the
 *   {@link AI_API_KEY_ENV} environment variable.
 */
export type AiGateway =
  | { type: "netlify" }
  | { type: "vercel" }
  | { type: "cloudflare"; accountId: string; gatewayId?: string }
  | { type: "custom"; baseUrl: string };

/** Where a gateway's OpenAI-compatible API lives, and what selects it there. */
export interface GatewayEndpoint {
  /** Base URL. Whoever calls it appends `chat/completions`. */
  baseUrl: string;
  /** Headers the gateway needs that are not the credential, so either side may send them. */
  headers: Record<string, string>;
}

/**
 * Where the relay finds a gateway credential: a server variable, or a header
 * the platform adds to every request.
 */
export type KeySource = { env: string } | { header: string };

/** A gateway addressed from the config alone, and where the relay finds its key. */
export interface GatewayAddress extends GatewayEndpoint {
  /** Tried in order, the first one set is the key. */
  keys: KeySource[];
  /**
   * Whether a browser may call it with the editor's own key (`byok`). Only the
   * ones known to answer a browser, so a gateway that would refuse it is caught
   * at build time rather than by every editor.
   */
  byok: boolean;
}

/**
 * The one statement of where a gateway is. The relay and a browser holding the
 * editor's own key both address it through here, so the two cannot drift into
 * reaching the same gateway by different routes. Null for `netlify`, whose
 * address comes from the server's environment.
 */
export function gatewayAddress(gateway: AiGateway): GatewayAddress | null {
  switch (gateway.type) {
    case "netlify":
      return null;
    case "vercel":
      return {
        baseUrl: "https://ai-gateway.vercel.sh/v1",
        headers: {},
        // An explicit key, otherwise the OIDC token Vercel sends fresh with every
        // request, then the build-time copy of it.
        keys: [
          { env: "AI_GATEWAY_API_KEY" },
          { header: "x-vercel-oidc-token" },
          { env: "VERCEL_OIDC_TOKEN" },
        ],
        byok: false,
      };
    case "cloudflare":
      return {
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${gateway.accountId}/ai/v1`,
        headers: { "cf-aig-gateway-id": gateway.gatewayId ?? "default" },
        keys: [{ env: "CLOUDFLARE_API_TOKEN" }],
        byok: true,
      };
    case "custom":
      return { baseUrl: gateway.baseUrl, headers: {}, keys: [{ env: AI_API_KEY_ENV }], byok: true };
  }
}

/** Netlify injects both into its functions, and the relay reads them only as a pair. */
export const NETLIFY_GATEWAY_ENV = ["OPENAI_BASE_URL", "OPENAI_API_KEY"] as const;

/** Every environment variable the relay may read for a gateway, so the integration can declare them. */
export function gatewayEnv(gateway: AiGateway): string[] {
  const address = gatewayAddress(gateway);

  if (!address) return [...NETLIFY_GATEWAY_ENV];

  return address.keys.flatMap((source) => ("env" in source ? [source.env] : []));
}
