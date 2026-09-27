import type { FileChange } from "./types.ts";

/** A hex SHA-256 of a string, the same in the browser and on the server. */
export async function sha256(content: string): Promise<string> {
  const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));

  return new Uint8Array(hashed).toHex();
}

/**
 * Names a changeset as a reviewer saw it, so publishing can refuse a changeset
 * that moved on after the review.
 */
export function changesetDigest(changes: readonly FileChange[]): Promise<string> {
  const identities = changes
    .map(({ kind, path, previousPath, patch, version }) =>
      JSON.stringify([kind, path, previousPath, patch, version]),
    )
    .sort();

  return sha256(JSON.stringify(identities));
}
