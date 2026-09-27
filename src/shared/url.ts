/**
 * URL primitives shared by the server relays, the admin bundle and the build.
 * Small enough to be tempting to re-write per call site, which is exactly why
 * they live in one place: a join that disagrees about slashes produces a URL
 * that resolves to the wrong thing rather than failing outright.
 */

/** Joins a base and a path with exactly one slash between them. */
export const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
