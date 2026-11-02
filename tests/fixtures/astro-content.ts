// Stand-in for astro's `astro:content`, holding a localized collection in memory.
const store: Record<string, string[]> = { texts: ["de/site", "en/site", "de/legal"] };

export async function getEntry(collection: string, id: string) {
  return store[collection]?.includes(id) ? { id, collection } : undefined;
}
