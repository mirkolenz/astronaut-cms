/**
 * Which operations only read.
 *
 * Everything the CMS does goes through one POST, so the HTTP method no longer
 * says whether a request changed anything. Two things need to know: the dev
 * server, which suppresses the reload a content write triggers, and the
 * assistant, which neither invalidates caches nor reports a change for a read.
 */
export const READ_ONLY_OPERATIONS: ReadonlySet<string> = new Set([
  "listEntries",
  "getEntry",
  "getFileLayout",
  "getStatus",
  "getChanges",
  "listMedia",
  "getReferences",
  "listTrash",
]);

export const isWriteOperation = (name: string): boolean => !READ_ONLY_OPERATIONS.has(name);
