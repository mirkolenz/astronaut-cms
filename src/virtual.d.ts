/// <reference types="vite/client" />

declare module "@mdxeditor/editor/style.css";

declare module "virtual:astronaut-cms/config" {
  import type { CmsClientConfig } from "./integration/types";
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
  import type { ComponentType } from "react";
  import type { JsxEditorProps } from "@mdxeditor/editor";
  import type { LucideIcon } from "lucide-react";
  import type { ZodFieldSchema } from "./client/components/editors/field-renderer";

  export interface ClientComponentDef {
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- ZodFieldSchema unresolvable by linter in virtual module declarations
    props: ZodFieldSchema | null;
    children?: "markdown" | Record<string, ClientComponentDef>;
    kind: "flow" | "text";
    source: string | null;
    defaultExport: boolean;
    label: string;
    icon: LucideIcon | null;
    editor: ComponentType<JsxEditorProps> | null;
  }

  export const components: Record<string, ClientComponentDef>;
}
