import config from "virtual:astronaut-cms/config";
import { joinUrl } from "@shared/url";

// Astro exposes the site `base` here, in whichever form the site configured it.
const base = import.meta.env.BASE_URL;

/**
 * Rewrites a URL's path to the form the host site's `trailingSlash` policy makes
 * Astro match. A mismatch either 404s (an injected API route) or fails to match
 * the callback URL registered with the OAuth provider. "ignore" matches both.
 */
export function conformTrailingSlash(rawUrl: string): string {
  if (config.trailingSlash === "ignore") return rawUrl;

  const url = new URL(rawUrl);
  url.pathname =
    config.trailingSlash === "always"
      ? url.pathname.replace(/\/?$/, "/")
      : url.pathname.replace(/(.)\/+$/, "$1");

  return url.href;
}

/**
 * Absolute URL for a root-relative CMS route — the admin mount point, or one of
 * the injected server routes. Astro prepends the site `base` to injected routes,
 * so the browser has to do the same to address them.
 */
export function siteUrl(path: string): string {
  return conformTrailingSlash(new URL(joinUrl(base, path), window.location.origin).href);
}
