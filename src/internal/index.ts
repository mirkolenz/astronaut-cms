/**
 * Machine-only entry points, exported as the single `astronaut-cms/internal`
 * scope. Not part of the public API: these are reached only by generated code
 * and build-time aliasing.
 *
 * - `loader-stubs`: aliased in for `astro:content` / `astro/loaders` when
 *   the integration loads the user's content config in Node.
 * - `editor-stubs`: aliased in for `astronaut-cms/editor` wherever the
 *   user's `cms.config.ts` loads outside the admin, where its editors never run.
 * - `user-config`: the `cms.config.ts` normalizer, run in Node by the
 *   integration and in the admin by the generated
 *   `virtual:astronaut-cms/user-config` module.
 * - `propsResolver` and `InferComponentProps`: what the generated component
 *   wrappers and their declarations read.
 * - `http` and `auth`: the response hardening and the root element id the
 *   injected routes, the admin page and the admin share, reached from
 *   `admin.astro`, which can only import package entry points.
 */
export * from "@/internal/loader-stubs";
export * from "@/internal/editor-stubs";
export * from "@/internal/user-config";
export { propsResolver, type InferComponentProps } from "@/shared/component-props";
export { HARDENING_HEADERS } from "@/shared/http";
export { ADMIN_ROOT_ID } from "@/shared/auth";
