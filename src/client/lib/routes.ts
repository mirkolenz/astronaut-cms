/**
 * Addressing and reaching the CMS API.
 *
 * Both halves are here rather than in `api.ts` because the session probe needs
 * them before there is any config to read, and `api.ts` reads the config. The
 * routing facts come from their own bundled module for the same reason: the
 * config is delivered by the probe, and the probe has to be addressed first.
 */
import routing from "virtual:astronaut-cms/routing";
import { conformTrailingSlash, joinUrl } from "@shared/url";

/** Absolute URL for a CMS API path, in the form the host's `trailingSlash` makes Astro match. */
export function apiUrl(path: string): string {
  return conformTrailingSlash(
    new URL(joinUrl(routing.base, path), window.location.origin).href,
    routing.trailingSlash,
  );
}

const ACCESS_PROXY_MESSAGE =
  "The request never reached the CMS. If an access proxy protects this site " +
  "(Cloudflare Access, Vercel Deployment Protection, Netlify SSO), its session " +
  "has expired — reload the page to sign in again.";

// A proxy that answers inline rather than redirecting sends its login page as
// HTML; the CMS routes only ever answer JSON or an event stream.
function isLoginInterstitial(response: Response): boolean {
  return (
    (response.status === 401 || response.status === 403) &&
    (response.headers.get("content-type") ?? "").includes("text/html")
  );
}

/**
 * `fetch` for the CMS's own routes, hardened against an access proxy in front of
 * the site. Those proxies answer an unauthenticated request with a redirect to
 * their own origin, which a browser `fetch` can only surface as an opaque CORS
 * failure — a lapsed proxy session would otherwise reach the user as a bare
 * "network error" on a site that is plainly still up. The CMS's own routes never
 * redirect except on the sign-in path, which is a navigation rather than a fetch,
 * so `redirect: "manual"` is a safe signal.
 */
export const apiFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, {
    ...init,
    credentials: "same-origin",
    redirect: "manual",
  });

  if (response.type === "opaqueredirect" || isLoginInterstitial(response)) {
    throw new Error(ACCESS_PROXY_MESSAGE);
  }

  return response;
};
