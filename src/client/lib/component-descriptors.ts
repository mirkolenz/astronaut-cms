import type { JsxComponentDescriptor, JsxPropertyDescriptor } from "@mdxeditor/editor";
import type { ClientComponentDef } from "virtual:astronaut-cms/user-config";
import type { ZodFieldSchema } from "@client/components/editors/field-renderer";
import { CmsComponentEditor } from "@client/components/editors/cms-component-editor";

/**
 * Converts a Zod schema field type to the closest MDXEditor property type.
 */
function zodTypeToJsxType(type: string): "string" | "number" | "expression" {
  switch (type) {
    case "string":
    case "email":
    case "url":
    case "enum":
      return "string";
    case "number":
    case "int":
      return "number";
    default:
      return "expression";
  }
}

/**
 * Unwraps optional/nullable/default/pipe wrappers to get the inner type.
 */
function unwrapType(schema: ZodFieldSchema): { type: string; required: boolean } {
  const t = schema.def.type;
  if ((t === "optional" || t === "nullable" || t === "default") && schema.unwrap) {
    const inner = unwrapType(schema.unwrap());
    return { type: inner.type, required: false };
  }
  if (t === "pipe" && schema.def.out) {
    return unwrapType(schema.def.out);
  }
  return { type: t, required: true };
}

/**
 * Converts a Zod object schema shape to an array of JsxPropertyDescriptors.
 */
function zodSchemaToJsxProps(schema: ZodFieldSchema | null): JsxPropertyDescriptor[] {
  if (!schema?.shape) return [];
  return Object.entries(schema.shape).map(([name, fieldSchema]) => {
    const { type, required } = unwrapType(fieldSchema);
    return {
      name,
      type: zodTypeToJsxType(type),
      required,
    };
  });
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
      props: zodSchemaToJsxProps(def.props),
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
