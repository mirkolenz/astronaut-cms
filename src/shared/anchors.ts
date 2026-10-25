/**
 * Links within a page. An `anchor()` field names an id that a component renders,
 * a Markdown heading gets the id astro derives from its text, and a link to
 * `#id`, from a `link()` field or the Markdown, has to name one of them, since a
 * fragment that matches no element scrolls nowhere and nothing else would say so.
 *
 * Only the entry itself is searched. A link to another page, such as
 * `/services/#heating`, is not checked: which entry a URL renders is up to the
 * routes of the site, which the CMS does not know.
 */
import type { z } from "zod";
import { diagnostic, type Diagnostic } from "./diagnostics.ts";
import type { ResolvableLeaf } from "./resolvable-leaves.ts";

const ANCHOR_MESSAGE = "Expected an anchor id without # or spaces, such as contact.";

export const ANCHOR_DESCRIPTION = "An element id, which a link in the same entry targets as #id.";

/** Whether a value can be an element id that a link reaches as `#value`. */
const isAnchor = (value: string): boolean => /^[^\s#]+$/.test(value);

/** Limits a string schema to anchor ids. */
export function anchorIds<T extends z.ZodType<string>>(schema: T): T {
  return schema.refine(isAnchor, ANCHOR_MESSAGE);
}

// Fragments a browser scrolls to without an element: the top of the page.
const IMPLICIT_FRAGMENTS: ReadonlySet<string> = new Set(["", "top"]);

// The id a link within the page targets, decoded as a browser matches it, or
// null for a link elsewhere.
function fragment(link: string): string | null {
  if (!link.startsWith("#")) return null;

  try {
    return decodeURIComponent(link.slice(1));
  } catch {
    return link.slice(1);
  }
}

/**
 * Every link to `#id` among an entry's leaves that names none of its anchors,
 * and every anchor defined twice, which leaves a link to it ambiguous.
 */
export function checkAnchors(leaves: ResolvableLeaf[]): Diagnostic[] {
  const anchors = leaves.filter((leaf) => leaf.kind === "anchor");
  const ids = new Set(anchors.map((anchor) => anchor.value));
  const known = ids.size
    ? `The anchors of this entry are ${[...ids].map((id) => `#${id}`).join(", ")}.`
    : "This entry defines no anchors. A prop that renders an id has to be declared with anchor().";

  const duplicates = anchors
    .filter((anchor, index) => anchors.findIndex((other) => other.value === anchor.value) !== index)
    .map((anchor) =>
      diagnostic(
        `defines the anchor "${anchor.value}" again, which has to be unique on the page.`,
        anchor.path,
      ),
    );

  const dead = leaves.flatMap((leaf) => {
    const id = leaf.kind === "link" ? fragment(leaf.value) : null;

    if (id === null || IMPLICIT_FRAGMENTS.has(id.toLowerCase()) || ids.has(id)) return [];

    return diagnostic(
      `links to "#${id}", which no anchor of this entry defines. ${known}`,
      leaf.path,
    );
  });

  return [...duplicates, ...dead];
}
