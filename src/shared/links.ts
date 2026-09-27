/**
 * The one policy for URLs in content. A URL may only be written where the schema
 * declares one, a `link()` or `z.url()` field or a Markdown link, and has to be
 * one a visitor can safely follow. Every other string may not act as a link at
 * all, since a component can render any prop as an `href` and nothing in its
 * schema would say so.
 *
 * Both checks resolve a value the way a browser resolves an `href`, which drops
 * tabs and newlines, trims control characters and ignores case, so no spelling
 * of a scheme gets past a plain string comparison.
 */
import type { z } from "zod";

const LINK_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

// Every scheme a browser acts on by itself: the ones a link may use, the ones
// that run or embed content, and the rest it navigates to or fetches. Any other
// scheme ("isbn:", "re:") is at most handed to an external app, with a prompt.
const NAVIGABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  ...LINK_PROTOCOLS,
  "javascript:",
  "vbscript:",
  "data:",
  "blob:",
  "file:",
  "ftp:",
  "ws:",
  "wss:",
]);

const BASE = new URL("https://relative.invalid/");

const LINK_KINDS = "relative, http, https, mailto or tel URL";

export const LINK_MESSAGE = `Expected a ${LINK_KINDS}.`;

export const LINK_DESCRIPTION = `A ${LINK_KINDS}.`;

export const PLAIN_TEXT_MESSAGE =
  "Plain text may not be a link. Declare the field with link() to hold a URL.";

const resolve = (value: string): URL | null => URL.parse(value, BASE);

/** Whether a value declared as a link points somewhere a visitor may follow. */
export function isAllowedLink(value: string): boolean {
  const url = resolve(value);

  return url !== null && LINK_PROTOCOLS.includes(url.protocol);
}

/** Limits a string schema to the links a visitor may follow. */
export function allowedLinks<T extends z.ZodType<string>>(schema: T): T {
  return schema.refine(isAllowedLink, LINK_MESSAGE);
}

/**
 * Whether plain text would act as a link if rendered as an `href`: it resolves
 * off the page, to a scheme a browser acts on or to another host. Prose that
 * merely contains a colon ("ISBN:978", "Update: new pricing") does not.
 */
export function isLinkLike(value: string): boolean {
  // Without a colon or a pair of slashes there is neither a scheme nor a host,
  // which settles nearly all prose without parsing it.
  if (!/:|[\\/]{2}/.test(value.replace(/[\t\n\r]/g, ""))) return false;

  const url = resolve(value);

  return url !== null && !url.href.startsWith(BASE.href) && NAVIGABLE_PROTOCOLS.has(url.protocol);
}

/** Whether any string inside a value of unknown shape acts as a link. */
export function containsLink(value: unknown): boolean {
  if (typeof value === "string") return isLinkLike(value);
  if (Array.isArray(value)) return value.some(containsLink);
  if (value && typeof value === "object") return Object.values(value).some(containsLink);

  return false;
}
