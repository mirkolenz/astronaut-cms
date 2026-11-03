/**
 * Schema-driven walk of an entry body, shared by the three places that need to
 * read a body the way the component registry defines it: the admin (and the AI
 * assistant) validating a write, the build refusing content the admin could not
 * save, and the build deciding which assets an entry actually reaches. All get
 * the same answer because all run this walk against the same `cms.config`
 * component manifest.
 *
 * A body is held to a small, fixed subset of what its format allows, since the
 * build compiles it and the site serves the result to every visitor. An MDX body
 * may import registered components, give them literal props, and wrap content in
 * a few plain HTML elements. Every other element, expression, handler or script
 * is code, and code belongs in a registered component, not in content.
 */
import type { Root } from "mdast";
import type { Program } from "estree";
import GithubSlugger from "github-slugger";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxjs } from "micromark-extension-mdxjs";
import {
  mdxFromMarkdown,
  type MdxJsxAttribute,
  type MdxJsxExpressionAttribute,
} from "mdast-util-mdx";
import { attributeValue, type StaticValue } from "@/shared/mdx-attributes";
import { childComponents, findComponent } from "@/shared/component-lookup";
import {
  isRequired,
  objectShape,
  type ComponentSchema,
  type ComponentSchemaMap,
} from "@/shared/field-schema";
import { fieldSchemaToZod } from "@/shared/field-to-zod";
import { collectResolvableLeaves, type ResolvableLeaf } from "@/shared/resolvable-leaves";
import { diagnostic, type Diagnostic } from "@/shared/diagnostics";
import { imageUrls } from "@/shared/markdown-images";
import { isAllowedLink, LINK_MESSAGE } from "@/shared/links";
import { errorMessage } from "@/shared/errors";

// The HTML an MDX body may use directly, enough to wrap content in utility classes.
const HTML_ELEMENTS: ReadonlySet<string> = new Set(["div", "span"]);
const HTML_ATTRIBUTES: ReadonlySet<string> = new Set(["class"]);

/** The parts of an mdast tree this walk reads. */
interface BodyNode {
  type: string;
  name?: string | null;
  url?: string;
  value?: string;
  attributes?: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>;
  children?: BodyNode[];
  data?: { estree?: Program | null };
}

// The nearest CMS-component ancestor of a node, or null at the document root.
type Parent = { name: string; def: ComponentSchema } | null;

// Everything the walk carries: the registry it validates against, the slugger that
// derives heading ids as astro does, plus the two output lists it appends to.
interface WalkContext {
  components: ComponentSchemaMap;
  topLevel: ReadonlySet<string>;
  slugger: GithubSlugger;
  diagnostics: Diagnostic[];
  leaves: ResolvableLeaf[];
}

// Capitalized names are components; lowercase ones are plain HTML with no schema.
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

// The text a node renders, which astro derives a heading's id from.
function textOf(node: BodyNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";

  return (node.children ?? []).map(textOf).join("");
}

// A heading is an anchor and a Markdown link may target one, so both are checked
// along with the anchors and links among the props.
function markdownLeaf(ctx: WalkContext, node: BodyNode): ResolvableLeaf | null {
  switch (node.type) {
    case "heading": {
      const text = textOf(node);

      return { kind: "anchor", value: ctx.slugger.slug(text), path: `heading "${text}"` };
    }

    case "link":
    case "definition":
      return node.url ? { kind: "link", value: node.url, path: "Markdown link" } : null;

    default:
      return null;
  }
}

// Why a node that is not a JSX element breaks the subset, or null when it does
// not. A missing program counts as code, so a parser that stops attaching one
// fails closed.
function nodeViolation(node: BodyNode): string | null {
  switch (node.type) {
    case "mdxjsEsm":
      return "Imports and exports are not allowed, every component of cms.config is available by name.";

    case "mdxFlowExpression":
    case "mdxTextExpression":
      return node.data?.estree?.body.length === 0
        ? null
        : "JavaScript expressions in braces are not allowed, only {/* comments */}.";

    case "html":
      return "Raw HTML is not allowed, use a registered component instead.";

    case "link":
    case "image":
    case "definition":
      return isAllowedLink(node.url ?? "")
        ? null
        : `The URL "${node.url}" is not allowed. ${LINK_MESSAGE}`;

    default:
      return null;
  }
}

// The props of any element as static values. A spread or a braced prop that
// only a runtime can evaluate is code, so it is reported here.
function readAttributes(
  ctx: WalkContext,
  name: string,
  attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>,
): Map<string, StaticValue> {
  const values = new Map<string, StaticValue>();

  for (const attr of attributes) {
    if (attr.type === "mdxJsxExpressionAttribute") {
      ctx.diagnostics.push(diagnostic(`<${name}> spreads props, which is not allowed.`));
      continue;
    }

    const value = attributeValue(attr);

    if (!value.known) {
      ctx.diagnostics.push(
        diagnostic(`<${name}> prop "${attr.name}" must be a literal value, not an expression.`),
      );
    }

    values.set(attr.name, value);
  }

  return values;
}

function validateHtml(ctx: WalkContext, name: string, values: Map<string, StaticValue>): void {
  if (!HTML_ELEMENTS.has(name)) {
    ctx.diagnostics.push(
      diagnostic(
        `<${name}> is not allowed, only ${[...HTML_ELEMENTS].map((e) => `<${e}>`).join(", ")}. Use a registered component instead.`,
      ),
    );

    return;
  }

  for (const attr of new Set(values.keys()).difference(HTML_ATTRIBUTES)) {
    ctx.diagnostics.push(
      diagnostic(
        `<${name}> attribute "${attr}" is not allowed, only ${[...HTML_ATTRIBUTES].join(", ")}.`,
      ),
    );
  }
}

function validateProps(
  ctx: WalkContext,
  name: string,
  def: ComponentSchema,
  values: Map<string, StaticValue>,
): void {
  // A component without an object schema takes no props, so every attribute,
  // an Astro directive such as `set:html` included, is an unknown one.
  const shape = objectShape(def.props) ?? {};

  for (const [prop, field] of Object.entries(shape)) {
    if (isRequired(field) && !values.has(prop)) {
      ctx.diagnostics.push(diagnostic(`<${name}> is missing required prop "${prop}".`));
    }
  }

  for (const [prop, attr] of values) {
    const field = shape[prop];

    if (!field) {
      ctx.diagnostics.push(diagnostic(`<${name}> has an unknown prop "${prop}".`));

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
      const reason = result.error.issues[0]?.message ?? "type mismatch";

      ctx.diagnostics.push(
        diagnostic(
          `<${name}> prop "${prop}" is invalid: ${reason.endsWith(".") ? reason : `${reason}.`}`,
        ),
      );
    }
  }
}

// Which component names may appear directly under a given parent, the top-level set at the document root.
function allowedChildren(ctx: WalkContext, parent: Parent): ReadonlySet<string> {
  return parent ? new Set(Object.keys(childComponents(parent.def, ctx.components))) : ctx.topLevel;
}

function placementMessage(name: string, parent: Parent, allowed: ReadonlySet<string>): string {
  if (!parent) return `<${name}> is not a top-level component and cannot be used here.`;

  const list = allowed.size ? `; allowed children: ${[...allowed].join(", ")}` : "";

  return `<${name}> is not allowed inside <${parent.name}>${list}.`;
}

function walk(ctx: WalkContext, nodes: BodyNode[], parent: Parent): void {
  const allowed = allowedChildren(ctx, parent);

  for (const node of nodes) {
    const violation = nodeViolation(node);

    if (violation) ctx.diagnostics.push(diagnostic(violation));

    const leaf = markdownLeaf(ctx, node);

    if (leaf) ctx.leaves.push(leaf);

    const isElement = node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
    // A fragment has no name and passes its component context through.
    const name = isElement ? node.name : null;

    if (name) {
      const values = readAttributes(ctx, name, node.attributes ?? []);
      const def = findComponent(name, ctx.components);

      if (def) {
        if (!allowed.has(name)) {
          ctx.diagnostics.push(diagnostic(placementMessage(name, parent, allowed)));
        }

        validateProps(ctx, name, def, values);

        if (node.children) walk(ctx, node.children, { name, def });

        continue;
      }

      if (isComponentName(name)) {
        ctx.diagnostics.push(
          diagnostic(`Unknown component <${name}>: it is not defined in this project.`),
        );
      } else {
        validateHtml(ctx, name, values);
      }
    }

    // Plain markdown nodes, fragments and HTML wrappers pass the component context through.
    if (node.children) walk(ctx, node.children, parent);
  }
}

export interface BodyValidation {
  diagnostics: Diagnostic[];
  /**
   * Asset, reference, link and anchor props found on components, plus the links
   * and headings of the Markdown, for the caller to resolve.
   */
  leaves: ResolvableLeaf[];
  /** URLs the body embeds as markdown images. */
  images: string[];
}

// Markdoc is read as the CommonMark it builds on, which is all its links,
// images and raw HTML need. Its tags have no schema in `cms.config`.
function parseBody(body: string, format: string): Root | null {
  if (format === "mdx") {
    return fromMarkdown(body, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] });
  }

  return format === "md" || format === "mdoc" ? fromMarkdown(body) : null;
}

/**
 * Validates an entry body against the subset the CMS allows: registered MDX
 * components with well-typed props where their parent allows them, a few plain
 * HTML wrappers, and links and images with a safe URL. The props that name
 * another resource come back as {@link ResolvableLeaf}s for the caller to check.
 * A data format has no body, so it yields nothing.
 */
export function validateBody(
  body: string,
  format: string,
  components: ComponentSchemaMap,
): BodyValidation {
  const empty = (diagnostics: Diagnostic[] = []): BodyValidation => ({
    diagnostics,
    leaves: [],
    images: [],
  });

  let root: Root | null;

  try {
    root = parseBody(body, format);
  } catch (err) {
    const message = errorMessage(err);

    return empty([diagnostic(`Failed to parse the body: ${message}`)]);
  }

  if (!root) return empty();

  const ctx: WalkContext = {
    components,
    topLevel: new Set(Object.keys(components)),
    slugger: new GithubSlugger(),
    diagnostics: [],
    leaves: [],
  };

  walk(ctx, root.children as BodyNode[], null);

  return { diagnostics: ctx.diagnostics, leaves: ctx.leaves, images: imageUrls(root) };
}
