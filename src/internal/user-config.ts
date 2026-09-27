/**
 * Browser-side normalization of the user's `cms.config.ts`. Runs inside the
 * admin bundle (it must, since component `icon`/`editor` are live React refs)
 * and lowers each component's Zod `props` into a serializable `FieldSchema`
 * via {@link zodToFieldSchema}, so the form renderer never sees a live Zod
 * instance. This module is intentionally free of any `astro:*` / `astro/*`
 * import, so nothing Node-only leaks into the client.
 */
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { JsxEditorProps } from "@mdxeditor/editor";
import type { ComponentDefinition } from "../config.ts";
import type { FieldSchema } from "../shared/field-schema.ts";
import { zodToFieldSchema } from "../shared/zod-to-field.ts";

export interface ClientComponentDef {
  props: FieldSchema | null;
  children?: "markdown" | Record<string, ClientComponentDef>;
  kind: "flow" | "text";
  source: string | null;
  defaultExport: boolean;
  label: string;
  icon: LucideIcon | null;
  editor: ComponentType<JsxEditorProps> | null;
}

export type ComponentManifest = Record<string, ClientComponentDef>;

export function processUserConfig(
  components: Record<string, ComponentDefinition> | undefined,
): ComponentManifest {
  const result: ComponentManifest = {};

  for (const [name, def] of Object.entries(components ?? {})) {
    result[name] = {
      props: def.props ? zodToFieldSchema(def.props) : null,
      children:
        typeof def.children === "object" ? processUserConfig(def.children) : def.children,
      kind: def.kind ?? "flow",
      source: def.source ?? null,
      defaultExport: def.defaultExport ?? false,
      label: def.label ?? name,
      icon: def.icon ?? null,
      editor: def.editor ?? null,
    };
  }

  return result;
}
