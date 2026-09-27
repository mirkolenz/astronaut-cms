import collections from "virtual:astronaut-cms/collections";
import config from "virtual:astronaut-cms/config";
import { stripExtension, stripMediaPrefix } from "@client/lib/storage/utils";
import { collectionBase, type FileChange } from "@shared/types";

/** A changed file mapped back onto the content model the user recognizes. */
export interface DescribedChange extends FileChange {
  /** Collection the file belongs to, when it is a collection entry. */
  collection?: string;
  /** Entry id, for a one-file-per-entry (glob) collection. */
  entryId?: string;
  /** What to show as the change's name. */
  label: string;
}

/**
 * Backends report changes as repository paths, which is the wrong vocabulary for
 * someone who thinks in entries and images. This maps a path back to the
 * collection entry or asset it holds, falling back to the raw path for anything
 * outside the content model.
 */
export function describeChange(change: FileChange): DescribedChange {
  const { path } = change;

  for (const [name, col] of Object.entries(collections)) {
    if (col.loaderFileName) {
      if (path === col.loaderFileName) return { ...change, collection: name, label: name };
      continue;
    }

    const base = `${collectionBase(name, col)}/`;

    if (path.startsWith(base)) {
      const entryId = stripExtension(path.slice(base.length));

      return { ...change, collection: name, entryId, label: `${name} / ${entryId}` };
    }
  }

  const mediaPath = stripMediaPrefix(path, config.mediaDirectory);

  return { ...change, label: mediaPath };
}
