/**
 * Entry order for the site, the same the admin shows. Astro's content store
 * returns a collection sorted by id and keeps no trace of the order a `file()`
 * collection's file holds, so a collection with a `sort` option is ordered here,
 * from what the integration read off the content.
 */
import { fileOrder, sorts } from "virtual:astronaut-cms/order";
import { compareIds, sortByIds } from "../shared/types.ts";

// Each file position by id, built once per module instance.
const ranks = new Map(
  Object.entries(fileOrder).map(([name, ids]) => [
    name,
    new Map(ids.map((id, index) => [id, index])),
  ]),
);

/** What ordering reads off an entry of astro's `getCollection`. */
interface CollectionEntry {
  id: string;
  collection: string;
}

/**
 * The entries of one collection, in the order its `sort` option names.
 *
 * @example
 * const events = sortEntries(await getCollection("events"));
 */
export function sortEntries<E extends CollectionEntry>(entries: readonly E[]): E[] {
  const collection = entries[0]?.collection ?? "";
  const sort = sorts[collection] ?? "id";
  const rank = ranks.get(collection);

  if (sort !== "file" || !rank) return sortByIds(entries, sort);

  // An entry the file does not hold yet, which a dev server can briefly see, sorts last.
  const position = (entry: E): number => rank.get(entry.id) ?? rank.size;
  const compare = compareIds(sort);

  return entries.toSorted((a, b) => position(a) - position(b) || compare(a.id, b.id));
}
