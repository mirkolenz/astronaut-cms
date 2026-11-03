/**
 * Browser-side normalization of the user's `cms.config.ts`. Runs inside the
 * admin bundle (it must, since component `icon`/`editor` are live React refs)
 * and lowers each component's Zod `props` into a serializable `FieldSchema`
 * via {@link zodToFieldSchema}, so the form renderer never sees a live Zod
 * instance. This module is intentionally free of any `astro:*` / `astro/*`
 * import, so nothing Node-only leaks into the client.
 */
import type { CollectionOptions, ComponentDefinition, ComponentIcon, JsxEditor } from "@/config";
import type { DescribedComponent } from "@/shared/field-schema";
import type { ContentI18n } from "@/shared/i18n";
import { zodToFieldSchema } from "@/shared/zod-to-field";
import { componentSchema } from "@/shared/component-props";

export interface ClientComponentDef extends DescribedComponent {
  icon: ComponentIcon | null;
  editor: JsxEditor | null;
}

export type ComponentManifest = Record<string, ClientComponentDef>;

/**
 * An MDX body refers to a component by its name alone, so one name may stand
 * for one definition only. A child set may reuse a definition under the same name.
 * `i18n` lays out the `localized()` props, see {@link zodToFieldSchema}.
 */
export function processUserConfig(
  components: Record<string, ComponentDefinition> | undefined,
  i18n: ContentI18n | null,
): ComponentManifest {
  const seen = new Map<string, ComponentDefinition>();

  const walk = (defs: Record<string, ComponentDefinition>): ComponentManifest => {
    const result: ComponentManifest = {};

    for (const [name, def] of Object.entries(defs)) {
      const previous = seen.get(name);

      if (previous && previous !== def) {
        throw new Error(
          `Component name "${name}" is defined twice in cms.config: names must be unique.`,
        );
      }

      seen.set(name, def);

      result[name] = {
        props: zodToFieldSchema(componentSchema(def), i18n),
        children: typeof def.children === "object" ? walk(def.children) : def.children,
        kind: def.kind ?? "flow",
        label: def.label ?? name,
        description: def.description ?? null,
        summary: def.summary ?? null,
        icon: def.icon ?? null,
        editor: def.editor ?? null,
        collections: def.collections ?? [],
      };
    }

    return result;
  };

  return walk(components ?? {});
}

/** The collections' icons by name, the one option the manifest cannot carry, being live components. */
export function processCollectionIcons(
  collections: Record<string, CollectionOptions> | undefined,
): Record<string, ComponentIcon> {
  return Object.fromEntries(
    Object.entries(collections ?? {}).flatMap(([name, { icon }]) => (icon ? [[name, icon]] : [])),
  );
}
