/**
 * Labels derived from names, for the admin and the agent tools alike. `scule` is
 * bundled into the admin only, so the server graph must not import this module.
 */
import { titleCase } from "scule";
import type { CollectionManifestEntry } from "./types.ts";

export const toLabel = (slug: string): string => titleCase(slug);

/** What editors and agents alike call a collection: its `label`, or its name title-cased. */
export function collectionLabel(col: Pick<CollectionManifestEntry, "name" | "label">): string {
  return col.label ?? toLabel(col.name);
}
