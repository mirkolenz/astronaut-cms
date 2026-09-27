import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import {
  mdxJsxFromMarkdown,
  type MdxJsxAttribute,
  type MdxJsxExpressionAttribute,
} from "mdast-util-mdx-jsx";
import { components, type ClientComponentDef } from "virtual:astronaut-cms/user-config";
import { findComponent } from "@client/lib/component-lookup";
import { objectShape, type FieldSchema } from "@shared/field-schema";
import { fieldSchemaToZod } from "@client/lib/ai/schema";
import { error, type Diagnostic } from "./types";

// A statically-known attribute value, or `unknown` for a dynamic `{expr}` we can
// not evaluate without running JS (left unchecked rather than guessed).
type AttrValue = { known: true; value: unknown } | { known: false };

// The nearest CMS-component ancestor of a node, or null at the document root.
type Parent = { name: string; def: ClientComponentDef } | null;

interface MdxNode {
  type: string;
  name?: string | null;
  attributes?: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>;
  children?: MdxNode[];
}

const NO_CHILDREN: ReadonlySet<string> = new Set();
const topLevelNames = new Set(Object.keys(components));

// Capitalized names are components; lowercase ones are plain HTML with no schema.
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function readAttrValue(attr: MdxJsxAttribute): AttrValue {
  const value = attr.value;

  if (value === null || value === undefined) return { known: true, value: true };

  if (typeof value === "string") return { known: true, value };

  try {
    return { known: true, value: JSON.parse(value.value) };
  } catch {
    return { known: false };
  }
}

function readAttributes(attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>): {
  values: Map<string, AttrValue>;
  hasSpread: boolean;
} {
  const values = new Map<string, AttrValue>();
  let hasSpread = false;

  for (const attr of attributes) {
    if (attr.type === "mdxJsxExpressionAttribute") {
      hasSpread = true;
      continue;
    }

    values.set(attr.name, readAttrValue(attr));
  }

  return { values, hasSpread };
}

function isRequired(field: FieldSchema): boolean {
  return !field.optional && !field.nullable && field.default === undefined;
}

function validateProps(
  name: string,
  def: ClientComponentDef,
  attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>,
  diagnostics: Diagnostic[],
): void {
  const shape = objectShape(def.props);

  if (!shape) return;

  const { values, hasSpread } = readAttributes(attributes);

  for (const [prop, field] of Object.entries(shape)) {
    if (isRequired(field) && !values.has(prop) && !hasSpread) {
      diagnostics.push(error(`<${name}> is missing required prop "${prop}".`));
    }
  }

  for (const [prop, attr] of values) {
    const field = shape[prop];

    if (!field) {
      if (!hasSpread) diagnostics.push(error(`<${name}> has an unknown prop "${prop}".`));

      continue;
    }

    if (!attr.known) continue;

    const result = fieldSchemaToZod(field).safeParse(attr.value);

    if (!result.success) {
      diagnostics.push(
        error(`<${name}> prop "${prop}" is invalid: ${result.error.issues[0]?.message ?? "type mismatch"}.`),
      );
    }
  }
}

// Which component names may appear directly under a given parent: the top-level
// set at the document root or under a markdown-children component, the declared
// child set for a component with a children map, and nothing for a leaf.
function allowedChildren(parent: Parent): ReadonlySet<string> {
  if (!parent) return topLevelNames;

  const children = parent.def.children;

  if (children === undefined) return NO_CHILDREN;
  if (children === "markdown") return topLevelNames;

  return new Set(Object.keys(children));
}

function placementMessage(name: string, parent: Parent, allowed: ReadonlySet<string>): string {
  if (!parent) return `<${name}> is not a top-level component and cannot be used here.`;

  const list = allowed.size ? `; allowed children: ${[...allowed].join(", ")}` : "";

  return `<${name}> is not allowed inside <${parent.name}>${list}.`;
}

function walk(nodes: MdxNode[], parent: Parent, diagnostics: Diagnostic[]): void {
  const allowed = allowedChildren(parent);

  for (const node of nodes) {
    const isElement = node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

    if (isElement && node.name) {
      const name = node.name;
      const def = findComponent(name, components);

      if (!def) {
        if (isComponentName(name)) {
          diagnostics.push(error(`Unknown component <${name}>: it is not defined in this project.`));
        }

        // Unknown name or HTML element: descendants keep the same component context.
        if (node.children) walk(node.children, parent, diagnostics);

        continue;
      }

      if (!allowed.has(name)) diagnostics.push(error(placementMessage(name, parent, allowed)));

      validateProps(name, def, node.attributes ?? [], diagnostics);

      if (node.children) walk(node.children, { name, def }, diagnostics);
    } else if (node.children) {
      // Fragments and plain markdown nodes pass the component context through.
      walk(node.children, parent, diagnostics);
    }
  }
}

/**
 * Validates the custom MDX components in an entry body against their registered
 * schemas: unknown components, missing/unknown/ill-typed props, and components
 * placed where their parent does not allow them. Non-MDX formats short-circuit.
 */
export function validateMdx(body: string, format: string): Diagnostic[] {
  if (format !== "mdx") return [];

  let tree: MdxNode;

  try {
    tree = fromMarkdown(body, {
      extensions: [mdxJsx()],
      mdastExtensions: [mdxJsxFromMarkdown()],
    }) as MdxNode;
  } catch (err) {
    return [error(`Failed to parse MDX: ${err instanceof Error ? err.message : String(err)}`)];
  }

  const diagnostics: Diagnostic[] = [];

  if (tree.children) walk(tree.children, null, diagnostics);

  return diagnostics;
}
