/**
 * Every entry point this package publishes, in one table.
 *
 * Three things have to agree about this list: `package.json` `exports` (what
 * Node resolves), `vite.config.ts` (what gets built), and `self-resolve.ts`
 * (what the workspace loads from source instead of `dist/`). They are all
 * derived from here, and `tests/entry-points.test.ts` holds `package.json` —
 * the one that cannot import this file — to the same table.
 */
export interface EntryPoint {
  /** The subpath under the package name, as `exports` spells it. */
  subpath: string;
  /** Where the entry point lives, relative to `src/`. */
  source: string;
}

export const PACKAGE_NAME = "astronaut-cms";

/** What the root export is called in `dist/`, where its subpath cannot name it. */
const ROOT_BUNDLE = "integration";

/** The admin is a browser bundle, so no declarations are emitted for it. */
export const CLIENT_SOURCES = "client/**";

export const ENTRY_POINTS: EntryPoint[] = [
  { subpath: ".", source: "integration/index.ts" },
  { subpath: "./config", source: "config.ts" },
  { subpath: "./admin.astro", source: "astro/admin.astro" },
  { subpath: "./Image.astro", source: "astro/Image.astro" },
  { subpath: "./Video.astro", source: "astro/Video.astro" },
  { subpath: "./assets", source: "assets/index.ts" },
  { subpath: "./media-presign", source: "media/presign.ts" },
  { subpath: "./client", source: "client/index.tsx" },
  { subpath: "./bootstrap", source: "client/bootstrap.ts" },
  { subpath: "./internal", source: "internal/index.ts" },
  { subpath: "./styles.css", source: "astro/styles.css" },
  { subpath: "./endpoint", source: "server/endpoint.ts" },
  { subpath: "./server-local", source: "server/storage/local.ts" },
];

export const specifierOf = ({ subpath }: EntryPoint): string =>
  subpath === "." ? PACKAGE_NAME : `${PACKAGE_NAME}${subpath.slice(1)}`;

/**
 * The bundle vite builds an entry point into, or null for one that is copied
 * verbatim — which is what a source that is not TypeScript always is.
 */
export const bundleOf = ({ subpath, source }: EntryPoint): string | null =>
  /\.tsx?$/.test(source) ? (subpath === "." ? ROOT_BUNDLE : subpath.slice(2)) : null;

/** The `exports` entry for one entry point, exactly as `package.json` carries it. */
export function exportsEntry(entry: EntryPoint): Record<string, string> {
  const bundle = bundleOf(entry);
  // Declarations are emitted for everything but the admin bundle, which is the
  // same rule `vite.config.ts` gives the dts plugin.
  const typed = bundle !== null && !entry.source.startsWith("client/");

  return {
    ...(typed && { types: `./dist/${entry.source.replace(/\.tsx?$/, ".d.ts")}` }),
    default: bundle === null ? `./dist/${entry.source}` : `./dist/${bundle}.js`,
  };
}
