/**
 * URL primitives shared by the server relays, the admin bundle and the build.
 * Small enough to be tempting to re-write per call site, which is exactly why
 * they live in one place: a join that disagrees about slashes produces a URL
 * that resolves to the wrong thing rather than failing outright.
 */
import { withoutLeadingSlash, withoutTrailingSlash, withTrailingSlash } from "ufo";

export { joinURL as joinUrl } from "ufo";

export const trimSlashes = (value: string): string => withoutLeadingSlash(withoutTrailingSlash(value));

/** Whether a value carries its own scheme rather than resolving against a base. */
export const isAbsoluteUrl = (value: string): boolean => URL.canParse(value);

/**
 * Rewrites a URL path into the form the host site's `trailingSlash` policy makes
 * Astro match. A mismatch either 404s (an injected API route) or fails to match
 * the callback URL registered with the OAuth provider. "ignore" matches both.
 */
export function conformTrailingSlash(
  rawUrl: string,
  policy: "always" | "never" | "ignore",
): string {
  if (policy === "ignore") return rawUrl;

  const url = new URL(rawUrl);

  url.pathname = policy === "always" ? withTrailingSlash(url.pathname) : withoutTrailingSlash(url.pathname);

  return url.href;
}
