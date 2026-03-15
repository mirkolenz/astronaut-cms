import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import remarkStringify from "remark-stringify";
import type { RootContent, Root, PhrasingContent, Paragraph } from "mdast";
import type {
  MdxJsxFlowElement,
  MdxJsxTextElement,
  MdxJsxAttribute,
  MdxJsxExpressionAttribute,
} from "mdast-util-mdx-jsx";

export interface TextBlock {
  id: string;
  type: "text";
  content: string;
}

export interface ComponentBlock {
  id: string;
  type: "component";
  name: string;
  props: Record<string, unknown>;
  children: Block[];
}

export type Block = TextBlock | ComponentBlock;

function generateId(): string {
  return crypto.randomUUID();
}

function isFlowJsx(node: RootContent): node is MdxJsxFlowElement {
  return node.type === "mdxJsxFlowElement";
}

function isTextJsx(node: { type: string }): node is MdxJsxTextElement {
  return node.type === "mdxJsxTextElement";
}

function extractProps(
  attributes: (MdxJsxAttribute | MdxJsxExpressionAttribute)[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const attr of attributes) {
    if (attr.type === "mdxJsxAttribute") {
      if (typeof attr.value === "string") {
        props[attr.name] = attr.value;
      } else if (attr.value && typeof attr.value === "object" && "value" in attr.value) {
        const raw = attr.value.value;
        try {
          props[attr.name] = JSON.parse(raw);
        } catch {
          props[attr.name] = raw;
        }
      } else {
        props[attr.name] = true;
      }
    }
  }
  return props;
}

const mdxStringifier = unified().use(remarkStringify).use(remarkMdx);

function nodesToMarkdown(nodes: RootContent[]): string {
  if (nodes.length === 0) return "";
  const tree: Root = { type: "root", children: nodes };
  return mdxStringifier.stringify(tree).trim();
}

function phrasingToMarkdown(nodes: PhrasingContent[]): string {
  if (nodes.length === 0) return "";
  const para: Paragraph = { type: "paragraph", children: nodes };
  const tree: Root = { type: "root", children: [para] };
  return mdxStringifier.stringify(tree).trim();
}

function isParagraph(node: RootContent): node is Paragraph {
  return node.type === "paragraph";
}

function jsxToComponentBlock(node: MdxJsxFlowElement | MdxJsxTextElement): ComponentBlock {
  const name = node.name ?? "Fragment";
  const props = extractProps(node.attributes);
  // For text elements, children are PhrasingContent; for flow elements, RootContent.
  // Process them accordingly.
  // mdast child types are not assignable to RootContent[] due to content model
  // constraints, but they are structurally compatible for our purposes.
  const children =
    node.type === "mdxJsxFlowElement"
      ? convertNodesToBlocks(node.children as RootContent[])
      : convertPhrasingToBlocks(node.children);
  return {
    id: generateId(),
    type: "component",
    name,
    props,
    children,
  };
}

/**
 * Convert phrasing (inline) content to blocks.
 * Extracts inline JSX elements as ComponentBlocks;
 * groups remaining text/inline nodes into TextBlocks.
 */
function convertPhrasingToBlocks(nodes: PhrasingContent[]): Block[] {
  const blocks: Block[] = [];
  let pending: PhrasingContent[] = [];

  const flushPending = () => {
    if (pending.length > 0) {
      const content = phrasingToMarkdown(pending);
      if (content) {
        blocks.push({ id: generateId(), type: "text", content });
      }
      pending = [];
    }
  };

  for (const node of nodes) {
    if (isTextJsx(node)) {
      flushPending();
      blocks.push(jsxToComponentBlock(node));
    } else {
      pending.push(node);
    }
  }
  flushPending();

  return blocks;
}

/**
 * Convert block-level (root/flow) content to blocks.
 * Extracts flow JSX elements directly, and looks inside paragraphs
 * for inline JSX elements (e.g. `<Tab>` on a single line gets parsed
 * as mdxJsxTextElement inside a paragraph).
 */
function convertNodesToBlocks(nodes: RootContent[]): Block[] {
  const blocks: Block[] = [];
  let pendingNodes: RootContent[] = [];

  const flushPending = () => {
    if (pendingNodes.length > 0) {
      const content = nodesToMarkdown(pendingNodes);
      if (content) {
        blocks.push({ id: generateId(), type: "text", content });
      }
      pendingNodes = [];
    }
  };

  for (const node of nodes) {
    if (isFlowJsx(node)) {
      flushPending();
      blocks.push(jsxToComponentBlock(node));
    } else if (isParagraph(node) && node.children.some((c) => isTextJsx(c))) {
      // Paragraph contains inline JSX — extract blocks from its children.
      flushPending();
      const inner = convertPhrasingToBlocks(node.children);
      blocks.push(...inner);
    } else {
      pendingNodes.push(node);
    }
  }
  flushPending();

  return blocks;
}

const mdxParser = unified().use(remarkParse).use(remarkMdx);

export function parseMdxToBlocks(source: string): Block[] {
  const tree = mdxParser.parse(source);
  return convertNodesToBlocks(tree.children);
}

function serializeProps(props: Record<string, unknown>): string {
  return Object.entries(props)
    .map(([key, value]) => {
      if (value === true) return key;
      if (typeof value === "string") return `${key}="${value}"`;
      return `${key}={${JSON.stringify(value)}}`;
    })
    .join(" ");
}

const PRINT_WIDTH = 80;

function indentLines(text: string, padding: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? padding + line : line))
    .join("\n");
}

function serializeBlock(block: Block, indent = 0): string {
  const padding = " ".repeat(indent);

  if (block.type === "text") {
    return indent > 0 ? indentLines(block.content, padding) : block.content;
  }

  const { name, props, children } = block;
  const propsStr = serializeProps(props);
  const opening = propsStr ? `<${name} ${propsStr}` : `<${name}`;

  if (children.length === 0) {
    return `${padding}${opening} />`;
  }

  // Inline short single-text children
  if (children.length === 1 && children[0].type === "text" && !children[0].content.includes("\n")) {
    const inline = `${opening}>${children[0].content}</${name}>`;
    if (indent + inline.length <= PRINT_WIDTH) {
      return `${padding}${inline}`;
    }
  }

  const childContent = children.map((child) => serializeBlock(child, indent + 2)).join("\n");
  return `${padding}${opening}>\n${childContent}\n${padding}</${name}>`;
}

export function serializeBlocksToMdx(blocks: Block[]): string {
  return blocks.map(serializeBlock).join("\n\n") + "\n";
}

/** Extract markdown content string from children blocks. */
export function getMarkdownContent(children: Block[]): string {
  return (
    children
      .filter((c): c is TextBlock => c.type === "text")
      .map((c) => c.content)
      .join("\n") || ""
  );
}

/** Filter out whitespace-only text blocks. */
export function getSignificantChildren(children: Block[]): Block[] {
  return children.filter((c) => c.type === "component" || (c.type === "text" && c.content.trim()));
}

/**
 * Infer how to render children based on config and actual block content.
 * Returns "none" | "markdown" | "components".
 */
export function inferChildrenMode(
  config: "markdown" | Record<string, unknown> | undefined,
  children: Block[],
): "none" | "markdown" | "components" {
  if (config === "markdown") return "markdown";
  if (typeof config === "object") return "components";

  if (children.length === 0) return "none";
  const hasComponents = children.some((c) => c.type === "component");
  if (hasComponents) return "components";
  const hasText = children.some((c) => c.type === "text" && c.content.trim());
  if (hasText) return "markdown";
  return "none";
}
