/**
 * Whether a collection can become a pair of tools at all.
 *
 * Both consumers of a tool name are strict about it and neither reports it
 * usefully: an OpenAI-compatible gateway rejects the *whole* request over one
 * bad name, so a single collection called "blog posts" takes the assistant down
 * entirely, and `document.modelContext.registerTool` rejects a promise nobody is
 * watching. A collection name is an object key in the user's `content.config`,
 * so neither of those is exotic.
 *
 * Stated here rather than in either binding, because the answer decides two
 * things at once: what the catalog offers, and what the integration tells the
 * person who can actually fix it.
 */
import { z } from "zod";
import { collectionDataSchema, collectionPatchSchema } from "../collection-schema.ts";
import type { CollectionManifestEntry } from "../types.ts";

/**
 * What a tool may be called, as the strictest of its consumers allows: WebMCP
 * takes `[A-Za-z0-9_.-]` up to 128 characters, a gateway's function names take
 * `[A-Za-z0-9_-]` up to 64, so the intersection is the rule.
 */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** The two tools a collection gets, which is also what its name has to survive. */
export const entryToolNames = (collection: string): string[] => [
  `writeEntry_${collection}`,
  `editEntry_${collection}`,
];

/**
 * Why this collection cannot be offered to an agent, or null when it can.
 *
 * The schema check is the round trip the browser makes — the manifest is lowered
 * from Zod when the integration loads the content config and reconstructed on
 * the other side, then described to an agent as JSON Schema. Running it once at
 * build is how a schema that cannot survive that is reported to a person rather
 * than discovered in a browser console.
 */
export function unexposable(name: string, col: CollectionManifestEntry): string | null {
  const refused = entryToolNames(name).find((tool) => !TOOL_NAME_PATTERN.test(tool));

  if (refused) {
    return `"${refused}" is not a usable tool name (letters, digits, "_" and "-" only, at most 64 characters).`;
  }

  try {
    for (const schema of [collectionDataSchema(col), collectionPatchSchema(col)]) {
      z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return `its schema cannot be described to an agent: ${reason}`;
  }

  return null;
}
