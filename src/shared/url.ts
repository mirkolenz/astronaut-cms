/**
 * URL primitives shared by the server relays, the admin bundle and the build.
 * Small enough to be tempting to re-write per call site, which is exactly why
 * they live in one place: a join that disagrees about slashes produces a URL
 * that resolves to the wrong thing rather than failing outright.
 */
export const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

/** Drops one trailing slash, keeping a lone "/" as the root. */
export const withoutTrailingSlash = (path: string): string => path.replace(/\/$/, "") || "/";

const withTrailingSlash = (path: string): string => (path.endsWith("/") ? path : `${path}/`);

/** Joins URL segments with exactly one slash between each, keeping the last one's trailing slash. */
export const joinUrl = (base: string, ...segments: string[]): string =>
  segments.reduce(
    (url, segment) =>
      !segment ? url : url ? withTrailingSlash(url) + segment.replace(/^\/+/, "") : segment,
    base,
  );

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
