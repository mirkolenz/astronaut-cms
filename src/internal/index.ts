/**
 * Machine-only entry points, exported as the single `astronaut-cms/internal`
 * scope. Not part of the public API: these are reached only by generated code
 * and build-time aliasing.
 *
 * - `loader-stubs`: aliased in for `astro:content` / `astro/loaders` when
 *   the integration loads the user's content config in Node.
 * - `editor-stubs`: aliased in for `astronaut-cms/editor` when it loads the
 *   user's `cms.config.ts`, whose editors only ever run in the admin.
 * - `user-config`: the `cms.config.ts` normalizer, run in Node by the
 *   integration and in the admin by the generated
 *   `virtual:astronaut-cms/user-config` module.
 * - `http` and `auth`: the response hardening and the root element id the
 *   injected routes, the admin page and the admin share, reached from
 *   `admin.astro`, which can only import package entry points.
 */
export * from "./loader-stubs.ts";
export * from "./editor-stubs.ts";
export * from "./user-config.ts";
export { HARDENING_HEADERS } from "../shared/http.ts";
export { ADMIN_ROOT_ID } from "../shared/auth.ts";
