/**
 * How the package resolves its own entry points.
 *
 * In this workspace the integration runs from `src/`, but Node resolution for
 * `astronaut-cms/*` lands on the published `dist/`. Two things have to agree
 * about which one wins, or the admin page and the API route load different
 * copies of the server: Vite's `resolveId` (for ordinary imports) and
 * `injectRoute`, which resolves its entrypoint itself before Vite sees it.
 *
 * A published install has no `src/`, so every lookup here falls through to the
 * specifier and Node resolves `dist/` as it should.
 */
import { existsSync } from "node:fs";
import { resolve } from "pathe";
import { ENTRY_POINTS, specifierOf } from "../entry-points.ts";

// Running from source rather than from `dist/`, which is fixed for the process,
// so it is decided once here and the lookups below stay pure.
const SOURCE_ROOT = existsSync(resolve(import.meta.dirname, "self-resolve.ts"))
  ? resolve(import.meta.dirname, "..")
  : undefined;

/** Specifier to source path, for the entry points whose sources exist. */
export const SOURCE_EXPORTS: Record<string, string> = SOURCE_ROOT
  ? Object.fromEntries(
      ENTRY_POINTS.map((entry) => [specifierOf(entry), resolve(SOURCE_ROOT, entry.source)]),
    )
  : {};

/** The entrypoint to hand `injectRoute`, which does its own resolution. */
export function routeEntrypoint(specifier: string): string {
  return SOURCE_EXPORTS[specifier] ?? specifier;
}
