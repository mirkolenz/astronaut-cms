/**
 * `fetch` for the CMS's own same-origin routes, hardened against an access proxy
 * (Cloudflare Access, Vercel Deployment Protection, Netlify SSO/password
 * protection) sitting in front of the site.
 *
 * Those proxies answer an unauthenticated request with a redirect to their own
 * login origin, or with an HTML interstitial. A browser `fetch` can only surface
 * the redirect as an opaque CORS failure, so a lapsed proxy session reaches the
 * user as a bare "network error" on a site that is plainly still up. Detecting it
 * here turns that into an accurate message: only a top-level navigation can
 * complete the proxy's sign-in, so reloading the page is the fix.
 *
 * The CMS's own routes never redirect, which is what makes `redirect: "manual"`
 * safe to use as the signal.
 *
 * Conforming the URL to the host's `trailingSlash` policy happens here too: the
 * rule applies to every request that addresses a CMS route, and this is by
 * definition the only thing that makes one.
 */
import { bearer } from "@shared/access";
import { tryGetToken } from "@client/lib/storage/utils";
import { conformTrailingSlash } from "@client/lib/site-url";

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

export const siteFetch: typeof fetch = async (input, init) => {
  // A `Request` carries its own URL, already built by whoever made it.
  const target =
    typeof input === "string" || input instanceof URL
      ? conformTrailingSlash(input.toString())
      : input;

  const response = await fetch(target, {
    ...init,
    // The proxy's session cookie rides along with the request; Access rejects it
    // outright without one.
    credentials: "same-origin",
    redirect: "manual",
  });

  if (response.type === "opaqueredirect" || isLoginInterstitial(response)) {
    throw new Error(ACCESS_PROXY_MESSAGE);
  }

  return response;
};

/**
 * The same, with the editor's Git token attached — which every injected route
 * except the auth relay gates on (see `denyUnlessWritable`).
 */
export const authedSiteFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);

  // One header, or none at all while the editor has no session yet.
  for (const [name, value] of Object.entries(bearer(tryGetToken()))) headers.set(name, value);

  return siteFetch(input, { ...init, headers });
};
