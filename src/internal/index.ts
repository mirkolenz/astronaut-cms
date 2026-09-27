/**
 * Machine-only entry points, exported as the single `astronaut-cms/internal`
 * scope. Not part of the public API: these are reached only by generated code
 * and build-time aliasing.
 *
 * - `loader-stubs`: aliased in for `astro:content` / `astro/loaders` when
 *   the integration loads the user's content config in Node.
 * - `editor-stubs`: aliased in for `astronaut-cms/editor` when it loads the
 *   user's `cms.config.ts`, whose editors only ever run in the admin.
 * - `user-config`: the browser-side `cms.config.ts` normalizer, imported by the
 *   generated `virtual:astronaut-cms/user-config` module.
 * - `http`: the response hardening the injected routes and the admin page share,
 *   reached from `admin.astro`, which can only import package entry points.
 */
export * from "./loader-stubs.ts";
export * from "./editor-stubs.ts";
export * from "./user-config.ts";
export { HARDENING_HEADERS } from "../shared/http.ts";
