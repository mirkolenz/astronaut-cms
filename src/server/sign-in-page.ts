/**
 * What an unauthenticated request to the admin is answered with.
 *
 * Kept apart from the API handler because it is the one thing the CMS renders
 * rather than serves: a document, with its own policy. That policy is stricter
 * than the admin's own (see `admin.astro`) because it can be — there is no
 * script on this page to permit, so nothing is permitted.
 */
import { HARDENING_HEADERS } from "../shared/http.ts";
import type { AdminState } from "./handler.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const escape = (value: string): string => value.replace(/[&<>"]/g, (char) => ESCAPES[char]);

/**
 * A link and nothing else: no bundle, no stylesheet, no CMS config.
 *
 * `error` is whatever the provider put on the callback, so it reaches the page
 * through the query string and is the one attacker-influenced value here.
 */
export function signInPage({ loginUrl, error, autoLogin }: AdminState, locale: string): Response {
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

  return new Response(
    `<!doctype html><html lang="${escape(locale)}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex, nofollow"><title>Astronaut CMS</title>` +
      // Already signed in at the edge, so the provider round trip is invisible.
      (autoLogin ? `<meta http-equiv="refresh" content="0; url=${escape(loginUrl)}">` : "") +
      `<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#18181b}` +
      `main{text-align:center}h1{font-size:1.1rem;font-weight:600}` +
      `a{display:inline-block;margin-top:1rem;padding:.5rem 1rem;border-radius:.375rem;background:#18181b;color:#fff;text-decoration:none}` +
      `p{color:#b91c1c;max-width:28rem}` +
      `@media(prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}a{background:#fafafa;color:#09090b}}</style>` +
      `</head><body><main><h1>Astronaut CMS</h1>` +
      (error ? `<p>${escape(error)}</p>` : "") +
      `<a href="${escape(loginUrl)}">Sign in</a></main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
        "x-frame-options": "DENY",
        "cache-control": "private, no-store",
        ...HARDENING_HEADERS,
      },
    },
  );
}

