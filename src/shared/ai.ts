import { API_BASE } from "./auth.ts";

/**
 * The AI relay, as the browser addresses it. It sits under the CMS API so one
 * injected route covers everything and one session cookie authenticates it; the
 * browser talks to it as an OpenAI-compatible endpoint, so the provider appends
 * `/chat/completions` itself.
 */
export const AI_API_BASE = `${API_BASE}/ai`;

/** Default maximum model/tool round-trips per assistant turn. */
export const DEFAULT_AI_MAX_STEPS = 24;

/**
 * Where the credential the assistant spends comes from.
 *
 * - `relay`: the deployment's, held on the server. Every model call is proxied,
 *   so the deployment enforces the model allowlist, the output ceiling and the
 *   per-editor rate — and pays for the invocation it is held open for.
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
 *   `ASTRONAUT_CMS_AI_API_KEY` environment variable.
 */
export type AiGateway =
  | { type: "netlify" }
  | { type: "vercel" }
  | { type: "cloudflare"; accountId: string; gatewayId?: string }
  | { type: "custom"; baseUrl: string };

/**
 * A gateway whose address is in the config rather than in the server's
 * environment. That is what makes it reachable from a browser, so it is also
 * exactly the set `byok` can work with.
 */
export type AddressableGateway = Extract<AiGateway, { type: "cloudflare" | "custom" }>;

export function isAddressable(gateway: AiGateway): gateway is AddressableGateway {
  return gateway.type === "cloudflare" || gateway.type === "custom";
}

/** Where a gateway's OpenAI-compatible API lives, and what selects it there. */
export interface GatewayEndpoint {
  /** Base URL. Whoever calls it appends `chat/completions`. */
  baseUrl: string;
  /** Headers the gateway needs that are not the credential, so either side may send them. */
  headers: Record<string, string>;
}

/**
 * The one statement of where a gateway is. The relay and a browser holding the
 * editor's own key both address it through here, so the two cannot drift into
 * reaching the same gateway by different routes.
 */
export function gatewayEndpoint(gateway: AddressableGateway): GatewayEndpoint {
  return gateway.type === "cloudflare"
    ? {
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${gateway.accountId}/ai/v1`,
        headers: { "cf-aig-gateway-id": gateway.gatewayId ?? "default" },
      }
    : { baseUrl: gateway.baseUrl, headers: {} };
}
