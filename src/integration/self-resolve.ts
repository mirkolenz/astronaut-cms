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
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "pathe";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PKG_JSON_PATH = resolve(PKG_ROOT, "package.json");

/** Specifier to source path, for the entry points whose sources exist. */
export const SOURCE_EXPORTS: Record<string, string> = existsSync(PKG_JSON_PATH)
  ? buildSourceExports(PKG_ROOT, PKG_JSON_PATH)
  : {};

function buildSourceExports(root: string, pkgPath: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    name: string;
    exports?: Record<string, { source?: string }>;
  };
  const map: Record<string, string> = {};

  for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
    // Existence is fixed for the process (workspace-linked source vs published
    // dist), so resolve it once here and keep the lookups pure.
    const sourcePath = conditions.source && resolve(root, conditions.source);

    if (sourcePath && existsSync(sourcePath)) {
      map[subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`] = sourcePath;
    }
  }

  return map;
}

/** The entrypoint to hand `injectRoute`, which does its own resolution. */
export function routeEntrypoint(specifier: string): string {
  return SOURCE_EXPORTS[specifier] ?? specifier;
}
