import type { JsxComponentDescriptor } from "@mdxeditor/editor";
import type { ClientComponentDef } from "@/internal/user-config";
import { componentEntries } from "@/shared/component-lookup";
import { CmsComponentEditor } from "@/client/components/editors/cms-component-editor";

/**
 * Converts a CMS ComponentDefinition map to an array of JsxComponentDescriptors.
 * Nested child components are included, since MDXEditor writes the import of
 * every component it finds in the body by its descriptor. Only MDXEditor's
 * generic editor reads `props`, and every component has an editor of its own.
 */
export function toJsxDescriptors(
  components: Record<string, ClientComponentDef>,
): JsxComponentDescriptor[] {
  return [...componentEntries(components)].map(([name, def]) => ({
    name,
    kind: def.kind,
    source: def.source ?? undefined,
    defaultExport: def.defaultExport,
    props: [],
    hasChildren: def.children !== undefined,
    Editor: def.editor ?? CmsComponentEditor,
  }));
}
