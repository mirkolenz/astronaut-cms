declare module "@mdxeditor/editor/style.css";

// Note: the inline `import("...").Type` form is used deliberately. A top-level
// `import type { X } from "..."` statement inside an ambient `declare module`
// silently resolves to `any` under this project's resolution settings.

declare module "virtual:astronaut-cms/config" {
  const config: import("./integration/types").CmsClientConfig;
  export default config;
}

declare module "virtual:astronaut-cms/ai-server" {
  const gateway: import("./integration/types").AiGateway | null;
  export default gateway;
}

declare module "virtual:astronaut-cms/assets" {
  /** Lazy asset loader maps, keyed by root-absolute path. Consumed by `astronaut-cms/assets`. */
  export const images: Record<string, () => Promise<import("astro").ImageMetadata>>;
  export const files: Record<string, () => Promise<string>>;
  /** Whether the maps hold only content-referenced assets (a build) or the whole media directory (dev). */
  export const referencedOnly: boolean;
}

declare module "virtual:astronaut-cms/collections" {
  const collections: import("./shared/types").CollectionManifest;
  export default collections;
}

declare module "virtual:astronaut-cms/user-config" {
  export type ClientComponentDef = import("./internal").ClientComponentDef;
  export const components: import("./internal").ComponentManifest;
}
