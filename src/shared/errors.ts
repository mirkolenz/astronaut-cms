/**
 * What a thrown value says, or `fallback` when it is no error. `Error.isError`
 * also recognizes an error from another realm, such as Vite's module runner.
 */
export const errorMessage = (err: unknown, fallback = String(err)): string =>
  Error.isError(err) ? err.message : fallback;
