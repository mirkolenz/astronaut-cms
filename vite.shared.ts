import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import type { Alias } from "vite";
import { ENTRY_POINTS, bundleOf } from "./src/entry-points.ts";

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"));

/**
 * Whether an import stays external to a bundle that shares `packages` with the
 * site, the builtins and the site's virtual modules. Everything else is
 * bundled, so a site installs none of it.
 */
export const externalTo =
  (packages: string[]) =>
  (id: string): boolean =>
    id.startsWith("virtual:") ||
    id.startsWith("astro:") ||
    [...builtinModules, ...packages].some(
      (name) => id === name || id === `node:${name}` || id.startsWith(`${name}/`),
    );

/** The peers, which is what the server side shares with the site. */
export const peers: string[] = Object.keys(pkg.peerDependencies ?? {});

export const srcDir = resolve(import.meta.dirname, "src");

export const aliases: Alias[] = [
  { find: "@", replacement: srcDir },
  // CommonJS `acorn-jsx` would otherwise pull in acorn's CommonJS build beside
  // the ES one micromark imports, the same parser twice.
  { find: /^acorn$/, replacement: resolve(import.meta.dirname, "node_modules/acorn/dist/acorn.mjs") },
];

/** The library entries of one of the two bundles, keyed by the file each is built into. */
export const libEntries = (admin: boolean): Record<string, string> =>
  Object.fromEntries(
    ENTRY_POINTS.filter((entry) => !entry.admin === !admin).flatMap((entry) => {
      const bundle = bundleOf(entry);

      return bundle === null ? [] : [[bundle, `src/${entry.source}`]];
    }),
  );
