/**
 * Schema-driven walk of the CMS components in an MDX body, shared by the two
 * places that need to read a body the way the component registry defines it: the
 * admin (and the AI assistant) validating a write, and the build deciding which
 * assets an entry actually reaches. Both get the same answer because both run
 * this walk against the same `cms.config` component manifest.
 */
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import {
  mdxJsxFromMarkdown,
  type MdxJsxAttribute,
  type MdxJsxExpressionAttribute,
} from "mdast-util-mdx-jsx";
import { attributeValue, type StaticValue } from "./mdx-attributes.ts";
import { findComponent } from "./component-lookup.ts";
import {
  isRequired,
  objectShape,
  type ComponentSchema,
  type ComponentSchemaMap,
} from "./field-schema.ts";
import { fieldSchemaToZod } from "./field-to-zod.ts";
import { collectResolvableLeaves, type ResolvableLeaf } from "./resolvable-leaves.ts";
import { diagnostic, type Diagnostic } from "./diagnostics.ts";
import { imageUrls } from "./markdown-images.ts";

/** The parts of an mdast tree this walk reads: JSX element names, attributes, children. */
interface MdxNode {
  type: string;
  name?: string | null;
  attributes?: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>;
  children?: MdxNode[];
}

// The nearest CMS-component ancestor of a node, or null at the document root.
type Parent = { name: string; def: ComponentSchema } | null;

// Everything the walk carries: the registry it validates against, plus the two
// output lists it appends to.
interface WalkContext {
  components: ComponentSchemaMap;
  topLevel: ReadonlySet<string>;
  diagnostics: Diagnostic[];
  leaves: ResolvableLeaf[];
}

const NO_CHILDREN: ReadonlySet<string> = new Set();

// Capitalized names are components; lowercase ones are plain HTML with no schema.
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function readAttributes(attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>): {
  values: Map<string, StaticValue>;
  hasSpread: boolean;
} {
  const values = new Map<string, StaticValue>();
  let hasSpread = false;

  for (const attr of attributes) {
    if (attr.type === "mdxJsxExpressionAttribute") {
      hasSpread = true;
      continue;
    }

    values.set(attr.name, attributeValue(attr));
  }

  return { values, hasSpread };
}

function validateProps(
  ctx: WalkContext,
  name: string,
  def: ComponentSchema,
  attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>,
): void {
  const shape = objectShape(def.props);

  if (!shape) return;

  const { values, hasSpread } = readAttributes(attributes);

  for (const [prop, field] of Object.entries(shape)) {
    if (isRequired(field) && !values.has(prop) && !hasSpread) {
      ctx.diagnostics.push(diagnostic(`<${name}> is missing required prop "${prop}".`));
    }
  }

  for (const [prop, attr] of values) {
    const field = shape[prop];

    if (!field) {
      if (!hasSpread) ctx.diagnostics.push(diagnostic(`<${name}> has an unknown prop "${prop}".`));

      continue;
    }

    if (!attr.known) continue;

    // An asset or reference prop is a string that still has to point at something
    // real, which the caller resolves against storage (the admin) or the media
    // directory (the build). Collected before the type check, so an unrelated
    // prop diagnostic can never quietly narrow what a build bundles. A value of
    // the wrong shape simply walks to no leaves.
    ctx.leaves.push(...collectResolvableLeaves(field, attr.value, `<${name}> prop "${prop}"`));

    const result = fieldSchemaToZod(field).safeParse(attr.value);

    if (!result.success) {
      ctx.diagnostics.push(
        diagnostic(
          `<${name}> prop "${prop}" is invalid: ${result.error.issues[0]?.message ?? "type mismatch"}.`,
        ),
      );
    }
  }
}

// Which component names may appear directly under a given parent: the top-level
// set at the document root or under a markdown-children component, the declared
// child set for a component with a children map, and nothing for a leaf.
function allowedChildren(ctx: WalkContext, parent: Parent): ReadonlySet<string> {
  if (!parent) return ctx.topLevel;

  const children = parent.def.children;

  if (children === undefined) return NO_CHILDREN;
  if (children === "markdown") return ctx.topLevel;

  return new Set(Object.keys(children));
}

function placementMessage(name: string, parent: Parent, allowed: ReadonlySet<string>): string {
  if (!parent) return `<${name}> is not a top-level component and cannot be used here.`;

  const list = allowed.size ? `; allowed children: ${[...allowed].join(", ")}` : "";

  return `<${name}> is not allowed inside <${parent.name}>${list}.`;
}

function walk(ctx: WalkContext, nodes: MdxNode[], parent: Parent): void {
  const allowed = allowedChildren(ctx, parent);

  for (const node of nodes) {
    const isElement = node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

    if (isElement && node.name) {
      const name = node.name;
      const def = findComponent(name, ctx.components);

      if (!def) {
        if (isComponentName(name)) {
          ctx.diagnostics.push(
            diagnostic(`Unknown component <${name}>: it is not defined in this project.`),
          );
        }

        // Unknown name or HTML element: descendants keep the same component context.
        if (node.children) walk(ctx, node.children, parent);

        continue;
      }

      if (!allowed.has(name)) {
        ctx.diagnostics.push(diagnostic(placementMessage(name, parent, allowed)));
      }

      validateProps(ctx, name, def, node.attributes ?? []);

      if (node.children) walk(ctx, node.children, { name, def });
    } else if (node.children) {
      // Fragments and plain markdown nodes pass the component context through.
      walk(ctx, node.children, parent);
    }
  }
}

export interface MdxValidation {
  diagnostics: Diagnostic[];
  /** Asset and reference props found on components, for the caller to resolve. */
  leaves: ResolvableLeaf[];
  /** URLs the body embeds as markdown images. */
  images: string[];
}

/**
 * Validates the custom MDX components in an entry body against their registered
 * schemas: unknown components, missing/unknown/ill-typed props, and components
 * placed where their parent does not allow them. The props that name another
 * resource come back as {@link ResolvableLeaf}s for the caller to check.
 *
 * Only an MDX body carries components: Markdown is prose, and Markdoc's tags have
 * no schema in `cms.config`. That rule lives here so neither caller restates it.
 */
export function validateMdx(
  body: string,
  format: string,
  components: ComponentSchemaMap,
): MdxValidation {
  if (format !== "mdx") return { diagnostics: [], leaves: [], images: [] };

  let root: Root;

  try {
    root = fromMarkdown(body, {
      extensions: [mdxJsx()],
      mdastExtensions: [mdxJsxFromMarkdown()],
    });
  } catch (err) {
    return {
      diagnostics: [
        diagnostic(`Failed to parse MDX: ${err instanceof Error ? err.message : String(err)}`),
      ],
      leaves: [],
      images: [],
    };
  }

  const tree = root as MdxNode;

  const ctx: WalkContext = {
    components,
    topLevel: new Set(Object.keys(components)),
    diagnostics: [],
    leaves: [],
  };

  if (tree.children) walk(ctx, tree.children, null);

  return { diagnostics: ctx.diagnostics, leaves: ctx.leaves, images: imageUrls(root) };
}
