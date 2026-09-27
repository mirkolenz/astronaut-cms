/**
 * Browser-side normalization of the user's `cms.config.ts`. Runs inside the
 * admin bundle (it must, since component `icon`/`editor` are live React refs)
 * and lowers each component's Zod `props` into a serializable `FieldSchema`
 * via {@link zodToFieldSchema}, so the form renderer never sees a live Zod
 * instance. This module is intentionally free of any `astro:*` / `astro/*`
 * import, so nothing Node-only leaks into the client.
 */
import type { ComponentDefinition, ComponentIcon, JsxEditor } from "../config.ts";
import type { ComponentSchema } from "../shared/field-schema.ts";
import { zodToFieldSchema } from "../shared/zod-to-field.ts";
import { schemaHelpers } from "../shared/cms-markers.ts";

export interface ClientComponentDef extends ComponentSchema {
  kind: "flow" | "text";
  source: string | null;
  defaultExport: boolean;
  label: string;
  description: string | null;
  summary: string | null;
  icon: ComponentIcon | null;
  editor: JsxEditor | null;
}

export type ComponentManifest = Record<string, ClientComponentDef>;

/**
 * An MDX body refers to a component by its name alone, both in its tags and in
 * the import the editor writes for it, so one name may stand for one definition
 * only. A child set may reuse a definition under the same name.
 */
export function processUserConfig(
  components: Record<string, ComponentDefinition> | undefined,
  seen = new Map<string, ComponentDefinition>(),
): ComponentManifest {
  const result: ComponentManifest = {};

  for (const [name, def] of Object.entries(components ?? {})) {
    const previous = seen.get(name);

    if (previous && previous !== def) {
      throw new Error(`Component name "${name}" is defined twice in cms.config: names must be unique.`);
    }

    seen.set(name, def);

    const props = typeof def.props === "function" ? def.props(schemaHelpers) : def.props;

    result[name] = {
      props: props ? zodToFieldSchema(props) : null,
      children:
        typeof def.children === "object" ? processUserConfig(def.children, seen) : def.children,
      kind: def.kind ?? "flow",
      source: def.source ?? null,
      defaultExport: def.defaultExport ?? false,
      label: def.label ?? name,
      description: def.description ?? null,
      summary: def.summary ?? null,
      icon: def.icon ?? null,
      editor: def.editor ?? null,
    };
  }

  return result;
}
