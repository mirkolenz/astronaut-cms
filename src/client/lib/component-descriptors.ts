import type { JsxComponentDescriptor, JsxPropertyDescriptor } from "@mdxeditor/editor";
import type { ClientComponentDef } from "virtual:astronaut-cms/user-config";
import { isRequired, type FieldSchema } from "@/shared/field-schema";
import { CmsComponentEditor } from "@/client/components/editors/cms-component-editor";

/**
 * Maps a field type to the closest MDXEditor property type.
 */
function fieldToJsxType(type: FieldSchema["type"]): "string" | "number" | "expression" {
  switch (type) {
    case "string":
    case "enum":
    case "literal":
    case "reference":
    case "image":
    case "file":
      return "string";
    case "number":
      return "number";
    default:
      return "expression";
  }
}

/**
 * Converts an object field schema to an array of JsxPropertyDescriptors.
 */
function schemaToJsxProps(schema: FieldSchema | null): JsxPropertyDescriptor[] {
  if (schema?.type !== "object") return [];
  return Object.entries(schema.shape).map(([name, field]) => ({
    name,
    type: fieldToJsxType(field.type),
    required: isRequired(field),
  }));
}

/**
 * Converts a CMS ComponentDefinition map to an array of JsxComponentDescriptors.
 * Recursively includes nested child component descriptors.
 */
export function toJsxDescriptors(
  components: Record<string, ClientComponentDef>,
): JsxComponentDescriptor[] {
  const descriptors: JsxComponentDescriptor[] = [];

  for (const [name, def] of Object.entries(components)) {
    descriptors.push({
      name,
      kind: def.kind,
      source: def.source ?? undefined,
      defaultExport: def.defaultExport,
      props: schemaToJsxProps(def.props),
      hasChildren: !!def.children,
      Editor: def.editor ?? CmsComponentEditor,
    });

    // Recursively add child component descriptors
    if (typeof def.children === "object") {
      descriptors.push(...toJsxDescriptors(def.children));
    }
  }

  return descriptors;
}
