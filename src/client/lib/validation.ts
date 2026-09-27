import config from "virtual:astronaut-cms/config";
import { collectionDataSchema, normalizeDates } from "@client/lib/schema";
import { validatePath } from "@shared/validation";
import type { CollectionManifestEntry } from "@shared/types";
import { dataLeaves, type ResolvableLeaf } from "@shared/resolvable-leaves";
import { components } from "virtual:astronaut-cms/user-config";
import { validateMdx } from "@shared/mdx-validation";
import { diagnostic, ContentValidationError, type Diagnostic } from "@shared/diagnostics";

export * from "@shared/diagnostics";

/**
 * What the checks need to look things up. The storage backend is passed in
 * rather than taken from `getStorage()` so that the backend itself can validate
 * its own writes without depending on the module that constructs it.
 */
export interface ContentSource {
  listEntries(collection: string): Promise<{ id: string }[]>;
  listMedia(): Promise<{ path: string }[]>;
}

/** An entry id must be a safe, slug-like path (the same rule the storage layer enforces). */
function validateEntryId(id: string): Diagnostic[] {
  try {
    validatePath(id, "entry id");

    return [];
  } catch (e) {
    return [diagnostic(e instanceof Error ? e.message : String(e))];
  }
}

/** A reorder must list every existing id exactly once: no unknown, missing, or duplicate ids. */
export function validateReorder(existing: string[], ids: string[]): Diagnostic[] {
  const existingSet = new Set(existing);
  const seen = new Set<string>();
  const unknown: string[] = [];
  const duplicates: string[] = [];

  for (const id of ids) {
    if (!existingSet.has(id)) unknown.push(id);
    if (seen.has(id)) duplicates.push(id);

    seen.add(id);
  }

  const missing = existing.filter((id) => !seen.has(id));
  const diagnostics: Diagnostic[] = [];

  if (unknown.length) diagnostics.push(diagnostic(`Unknown entry id(s): ${unknown.join(", ")}.`));
  if (missing.length) {
    diagnostics.push(
      diagnostic(`Every entry must appear exactly once; missing: ${missing.join(", ")}.`),
    );
  }
  if (duplicates.length)
    diagnostics.push(diagnostic(`Duplicate entry id(s): ${duplicates.join(", ")}.`));

  return diagnostics;
}

async function checkReferences(
  source: ContentSource,
  references: ResolvableLeaf[],
): Promise<Diagnostic[]> {
  const byCollection = new Map<string, ResolvableLeaf[]>();

  for (const ref of references) {
    const collection = ref.collection ?? "";
    const list = byCollection.get(collection) ?? [];
    list.push(ref);
    byCollection.set(collection, list);
  }

  const groups = await Promise.all(
    [...byCollection].map(async ([collection, refs]) => {
      const ids = new Set((await source.listEntries(collection)).map((e) => e.id));

      return refs
        .filter((ref) => !ids.has(ref.value))
        .map((ref) =>
          diagnostic(
            `references "${ref.value}", which does not exist in collection "${collection}".`,
            ref.path,
          ),
        );
    }),
  );

  return groups.flat();
}

/**
 * An `image`/`file` field must name a file in the media directory, and nothing
 * else. This is not a house rule: the site resolves these paths through a map
 * rooted at the media directory (see the generated `virtual:astronaut-cms/assets`
 * module), so a path outside it cannot resolve at render time no matter what the
 * file system holds, and a path inside it that does not exist fails the same way.
 * A build takes it further and refuses to start, since the same walk decides
 * which assets are bundled at all.
 */
async function checkAssets(source: ContentSource, assets: ResolvableLeaf[]): Promise<Diagnostic[]> {
  if (assets.length === 0) return [];

  const mediaDirectory = config.mediaDirectory.replace(/^\/|\/$/g, "");
  const paths = new Set((await source.listMedia()).map((m) => m.path));

  return assets.flatMap((asset) => {
    const normalized = asset.value.replace(/^\//, "");

    if (!normalized.startsWith(`${mediaDirectory}/`)) {
      return diagnostic(
        `"${asset.value}" is outside the media directory ("${mediaDirectory}"). Assets must live in the media library; upload the file there and use the path listMedia reports.`,
        asset.path,
      );
    }

    if (!paths.has(normalized)) {
      return diagnostic(
        `"${asset.value}" is not in the media library. Use a path listMedia reports.`,
        asset.path,
      );
    }

    return [];
  });
}

/** A media path names an existing file in the media library, by the same rule. */
export function validateMediaExists(source: ContentSource, path: string): Promise<Diagnostic[]> {
  return checkAssets(source, [{ kind: "file", value: path, path: "" }]);
}

/**
 * The data must satisfy the collection's own schema. Writing an entry that does
 * not is the one CMS mistake the site cannot survive: Astro's content sync
 * throws on it, and the full sync it runs at startup is uncaught, so the dev
 * server exits and will not come back until the file is fixed by hand.
 *
 * The reconstructed schema is never stricter than the original (see
 * `fieldSchemaToZod`), so this catches every structural violation while never
 * blocking a write the real schema would have accepted.
 */
export function validateAgainstSchema(
  col: CollectionManifestEntry,
  data: Record<string, unknown>,
): Diagnostic[] {
  const result = collectionDataSchema(col).safeParse(normalizeDates(data));

  if (result.success) return [];

  return result.error.issues.map((issue) =>
    diagnostic(issue.message, issue.path.join(".") || undefined),
  );
}

/**
 * Cross-resource integrity for the fields the lowered schema can only type as
 * `string`: a `reference` must resolve to an existing entry and an `image`/`file`
 * to a file in the media library. These are the values a model can get past the
 * tool's JSON Schema while still pointing at nothing, so they are checked here
 * rather than by the schema.
 */
async function checkResolvableLeaves(
  source: ContentSource,
  leaves: ResolvableLeaf[],
): Promise<Diagnostic[]> {
  if (leaves.length === 0) return [];

  const [references, assets] = await Promise.all([
    checkReferences(
      source,
      leaves.filter((l) => l.kind === "reference"),
    ),
    checkAssets(
      source,
      leaves.filter((l) => l.kind !== "reference"),
    ),
  ]);

  return [...references, ...assets];
}

// --- Entry writes ----------------------------------------------------------

export interface EntryWrite {
  col: CollectionManifestEntry;
  id: string;
  data: Record<string, unknown>;
  body: string;
  format: string;
}

/**
 * Everything that has to hold before an entry may be written: a slug-safe id,
 * data matching the collection's schema, well-formed MDX components, and every
 * asset and reference — from the frontmatter and from the component props alike
 * — resolving to something that exists. The two leaf sources are resolved
 * together so the media library and each referenced collection are listed once
 * per write.
 */
async function validateEntryWrite(
  source: ContentSource,
  { col, id, data, body, format }: EntryWrite,
): Promise<Diagnostic[]> {
  const mdx = validateMdx(body, format, components);

  return [
    ...validateEntryId(id),
    ...validateAgainstSchema(col, data),
    ...mdx.diagnostics,
    ...(await checkResolvableLeaves(source, [...dataLeaves(col.schema, data), ...mdx.leaves])),
  ];
}

/** Throws {@link ContentValidationError} unless the entry is safe to write. */
export async function assertEntryWritable(source: ContentSource, write: EntryWrite): Promise<void> {
  const diagnostics = await validateEntryWrite(source, write);

  if (diagnostics.length > 0) throw new ContentValidationError(diagnostics);
}
