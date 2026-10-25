/**
 * The rules an entry has to satisfy that need nothing but the entry itself,
 * shared by the build, which refuses what is on disk, and a save, which refuses
 * what would be written, so that both hold content to the same rules.
 */
import { validateAgainstSchema } from "./collection-schema.ts";
import { checkAnchors } from "./anchors.ts";
import type { BodyValidation } from "./body-validation.ts";
import { diagnostic, type Diagnostic } from "./diagnostics.ts";
import { dataLeaves, type ResolvableLeaf } from "./resolvable-leaves.ts";
import {
  collectionBase,
  globEntry,
  globEntryId,
  loaderPatterns,
  type CollectionManifestEntry,
} from "./types.ts";

export interface EntryCheck {
  diagnostics: Diagnostic[];
  /** The resolvable values of the data and the body, which only a lookup can check. */
  leaves: ResolvableLeaf[];
}

/**
 * A glob loader reads only the files its pattern matches, each under the id
 * astro derives from it. A write anywhere else, or to a file astro names
 * differently, adds an entry the site never sees under this id. A `slug` that
 * renames the entry is refused too, since the CMS lists entries by their files
 * without reading each and would know it under an id astro does not.
 */
function checkLoaded(
  col: CollectionManifestEntry,
  path: string,
  data: Record<string, unknown>,
  id: string | undefined,
): Diagnostic[] {
  if (col.loaderType !== "glob") return [];

  const loaded = globEntry(col, path);

  if (!loaded) {
    return [
      diagnostic(
        `The "${col.name}" collection loads only files matching "${loaderPatterns(col).join(", ")}" in "${collectionBase(col) || "."}", which "${path}" does not. Use an id and format the pattern matches.`,
      ),
    ];
  }

  if (id !== undefined && loaded.id !== id) {
    return [
      diagnostic(
        `Astro names the file "${path}" "${loaded.id}" rather than "${id}". Use "${loaded.id}" as the id.`,
      ),
    ];
  }

  if (!data.slug) return [];

  const astroId = globEntryId(col, path, data);

  return astroId === loaded.id
    ? []
    : [
        diagnostic(
          `Its "slug" field makes astro name this entry "${astroId}" rather than "${loaded.id}". Remove the field or set it to "${loaded.id}".`,
        ),
      ];
}

/**
 * Every finding about an entry that its own content decides: data matching the
 * collection's schema, a body within the allowed subset, every link to `#id`
 * naming an anchor of the entry, and a file astro loads under its id. `id` is
 * the one a save names the entry by, omitted for a file read from disk.
 */
export function checkEntry(
  col: CollectionManifestEntry,
  entry: { path: string; data: Record<string, unknown>; body: BodyValidation | null; id?: string },
): EntryCheck {
  const { path, data, body, id } = entry;
  const leaves = [...dataLeaves(col.schema, data), ...(body?.leaves ?? [])];

  return {
    diagnostics: [
      ...checkLoaded(col, path, data, id),
      ...validateAgainstSchema(col, data),
      ...(body?.diagnostics ?? []),
      ...checkAnchors(leaves),
    ],
    leaves,
  };
}
