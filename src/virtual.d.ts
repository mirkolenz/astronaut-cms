declare module "virtual:astronaut-cms/config" {
  import type { SupportedLocale } from "./integration/types";
  interface CmsClientConfig {
    mountPoint: string;
    storageType: "local" | "github" | "gitlab";
    mediaDirectory: string;
    locale: SupportedLocale;
    github?: {
      repo: string;
      branch: string;
      clientId: string;
    };
    gitlab?: {
      project: string;
      branch: string;
      clientId: string;
      instanceUrl: string;
    };
  }
  const config: CmsClientConfig;
  export default config;
}

declare module "virtual:astronaut-cms/collections" {
  import type { ZodFieldSchema } from "./client/components/editors/field-renderer";
  const collections: Record<
    string,
    {
      name: string;
      type: "content" | "data";
      schema: ZodFieldSchema;
      loaderPattern: string | string[] | null;
      loaderBase: string | null;
      loaderFileName: string | null;
      loaderType: "glob" | "file";
    }
  >;
  export default collections;
}

declare module "virtual:astronaut-cms/user-config" {
  import type { ComponentType, ReactNode } from "react";
  import type { PluggableList } from "unified";
  import type { ZodFieldSchema } from "./client/components/editors/field-renderer";

  export interface ClientComponentDef {
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- ZodFieldSchema unresolvable by linter in virtual module declarations
    props: ZodFieldSchema | null;
    children?: "markdown" | Record<string, ClientComponentDef>;
    label: string;
    icon: string | null;
    wrapper: ComponentType<{ children: ReactNode }> | null;
  }

  export const components: Record<string, ClientComponentDef>;
  export const remarkPlugins: PluggableList;
  export const rehypePlugins: PluggableList;
}
