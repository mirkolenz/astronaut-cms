/**
 * A component element as the admin edits it: its props as values, and its
 * structured children as a tree addressed by keys that survive edits, moves and
 * undo. Every change returns a new element and rewrites only what it touches,
 * so attributes the form cannot read keep their source text.
 */
import type { RootContent } from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";
import type { ClientComponentDef } from "@/internal/user-config";
import type {
  MdxJsxAttribute,
  MdxJsxElement,
  MdxJsxExpressionAttribute,
} from "@/shared/jsx-editor";
import { childComponents } from "@/shared/component-lookup";
import { objectShape } from "@/shared/field-schema";
import { attributeValue, valueToAttribute } from "@/shared/mdx-attributes";
import { arrayMove } from "@/client/lib/arrays";
import { getDefaultValue, missingFields, textSummary } from "@/client/lib/field-values";

declare module "mdast" {
  interface Data {
    /** The admin's key for a structured child, which markdown never serializes. */
    cmsKey?: string;
  }
}

/** A component written inside another one. */
export type JsxChild = MdxJsxFlowElement | MdxJsxTextElement;

/** The keys of the structured children leading from a component to one below it. */
export type ChildPath = readonly string[];

export function isJsxElement(node: RootContent): node is JsxChild {
  return node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
}

/**
 * A child's key, assigned on first sight. It lives in the mdast `data`, which
 * every clone of the tree carries along, so the one element keeps it for good.
 */
export function childKey(child: JsxChild): string {
  child.data ??= {};

  return (child.data.cmsKey ??= crypto.randomUUID());
}

export function jsxChildren(element: MdxJsxElement): JsxChild[] {
  return element.children.filter(isJsxElement);
}

export function findAt<T extends MdxJsxElement>(
  element: T,
  path: ChildPath,
): T | JsxChild | undefined {
  let current: T | JsxChild | undefined = element;

  for (const key of path)
    current = current && jsxChildren(current).find((c) => childKey(c) === key);

  return current;
}

export function updateAt(
  element: MdxJsxElement,
  path: ChildPath,
  update: (target: MdxJsxElement) => MdxJsxElement,
): MdxJsxElement {
  const [key, ...rest] = path;

  if (key === undefined) return update(element);

  return {
    ...element,
    children: element.children.map((child) =>
      isJsxElement(child) && childKey(child) === key
        ? // Only attributes and children change, so the child stays the element it was.
          ({ ...child, ...updateAt(child, rest, update) } as JsxChild)
        : child,
    ),
  };
}

/** The definition of the element at `path` below a component defined by `def`. */
export function defAt(
  def: ClientComponentDef | undefined,
  root: MdxJsxElement,
  path: ChildPath,
): ClientComponentDef | undefined {
  let current = def;
  let element: MdxJsxElement | undefined = root;

  for (const key of path) {
    element = element && jsxChildren(element).find((c) => childKey(c) === key);
    current =
      element?.name && typeof current?.children === "object"
        ? current.children[element.name]
        : undefined;
  }

  return current;
}

// ── Props ───────────────────────────────────────────────────────────

const isAttribute = (
  attr: MdxJsxAttribute | MdxJsxExpressionAttribute,
  key?: string,
): attr is MdxJsxAttribute =>
  attr.type === "mdxJsxAttribute" && (key === undefined || attr.name === key);

/**
 * The statically-known props of an element. An expression only a runtime can
 * produce is left out: the form cannot show it, and it survives untouched since
 * {@link withProp} rewrites nothing but the prop it sets.
 */
export function readProps(element: MdxJsxElement): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  for (const attr of element.attributes) {
    if (!isAttribute(attr)) continue;

    const value = attributeValue(attr);

    if (value.known) props[attr.name] = value.value;
  }

  return props;
}

/** The element with one prop set, or removed for `undefined`. */
export function withProp(element: MdxJsxElement, key: string, value: unknown): MdxJsxElement {
  if (value === undefined) {
    return { ...element, attributes: element.attributes.filter((attr) => !isAttribute(attr, key)) };
  }

  const attribute = valueToAttribute(key, value);

  return {
    ...element,
    attributes: element.attributes.some((attr) => isAttribute(attr, key))
      ? element.attributes.map((attr) => (isAttribute(attr, key) ? attribute : attr))
      : [...element.attributes, attribute],
  };
}

/** The props a new instance is written with: every default a field has, and nothing it may leave out. */
export function defaultProps(def: ClientComponentDef): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(objectShape(def.props) ?? {}).flatMap(([key, field]) => {
      const value = getDefaultValue(field);

      return value === undefined || value === null ? [] : [[key, value]];
    }),
  );
}

/** What an instance is called in the admin. */
export function labelOf(def: ClientComponentDef | undefined, element: MdxJsxElement): string {
  return def?.label ?? element.name ?? "Fragment";
}

/** The one-line name of an instance, such as its title. */
export function summaryOf(
  def: ClientComponentDef | undefined,
  element: MdxJsxElement,
): string | undefined {
  return textSummary(objectShape(def?.props) ?? {}, readProps(element), def?.summary);
}

/** The labels of the required props an instance has no value for. */
export function missingProps(
  def: ClientComponentDef | undefined,
  element: MdxJsxElement,
): string[] {
  const shape = objectShape(def?.props);

  // A spread may supply any prop, so none can be said to be missing.
  if (!shape || element.attributes.some((attr) => !isAttribute(attr))) return [];

  const props = readProps(element);
  const written = new Set(
    element.attributes.filter((attr) => isAttribute(attr)).map((attr) => attr.name),
  );

  return missingFields(shape, (key) => !written.has(key) || props[key] === "");
}

/** The first image an instance shows, for its thumbnail. */
export function imageOf(
  def: ClientComponentDef | undefined,
  element: MdxJsxElement,
): string | undefined {
  const props = readProps(element);

  return Object.entries(objectShape(def?.props) ?? {})
    .filter(([, field]) => field.type === "image")
    .map(([key]) => props[key])
    .find((value): value is string => typeof value === "string" && value !== "");
}

/** An element as content of a markdown body, where an inline one sits in a paragraph. */
export function asBlockContent(element: JsxChild): RootContent {
  return element.type === "mdxJsxTextElement"
    ? { type: "paragraph", children: [element] }
    : element;
}

// ── Structured children ─────────────────────────────────────────────

/** A new instance with its default props, keyed already so it can be selected right away. */
export function newComponent(name: string, def: ClientComponentDef): JsxChild {
  const attributes = Object.entries(defaultProps(def)).map(([key, value]) =>
    valueToAttribute(key, value),
  );
  const data = { cmsKey: crypto.randomUUID() };

  return def.kind === "text"
    ? { type: "mdxJsxTextElement", name, attributes, children: [], data }
    : { type: "mdxJsxFlowElement", name, attributes, children: [], data };
}

// Other content keeps its place, and the component children fill their slots in
// the given order, any extra ones after the rest.
function withJsxChildren(parent: MdxJsxElement, next: JsxChild[]): MdxJsxElement {
  let index = 0;
  const children = parent.children.flatMap<RootContent>((child) => {
    if (!isJsxElement(child)) return [child];

    const replacement = next[index++];

    return replacement ? [replacement] : [];
  });

  return { ...parent, children: [...children, ...next.slice(index)] };
}

function editChildren(
  root: MdxJsxElement,
  parentPath: ChildPath,
  edit: (children: JsxChild[]) => JsxChild[],
): MdxJsxElement {
  return updateAt(root, parentPath, (parent) => withJsxChildren(parent, edit(jsxChildren(parent))));
}

export function addChildren(
  root: MdxJsxElement,
  parentPath: ChildPath,
  added: JsxChild[],
): MdxJsxElement {
  return editChildren(root, parentPath, (children) => [...children, ...added]);
}

export function removeChild(
  root: MdxJsxElement,
  parentPath: ChildPath,
  key: string,
): MdxJsxElement {
  return editChildren(root, parentPath, (children) => children.filter((c) => childKey(c) !== key));
}

/** Moves a child to the place `to` among its siblings. */
export function moveChild(
  root: MdxJsxElement,
  parentPath: ChildPath,
  key: string,
  to: number,
): MdxJsxElement {
  return editChildren(root, parentPath, (children) => {
    const from = children.findIndex((c) => childKey(c) === key);

    return from < 0 ? children : arrayMove(children, from, to);
  });
}

/** Inserts a copy of a child right after it, with keys of its own. */
export function duplicateChild(
  root: MdxJsxElement,
  parentPath: ChildPath,
  key: string,
): MdxJsxElement {
  return editChildren(root, parentPath, (children) =>
    children.flatMap((child) => (childKey(child) === key ? [child, freshCopy(child)] : [child])),
  );
}

function freshCopy(child: JsxChild): JsxChild {
  const copy = structuredClone(child);
  const forget = (node: RootContent) => {
    if (node.data) delete node.data.cmsKey;
    if ("children" in node) node.children.forEach(forget);
  };

  forget(copy);

  return copy;
}

// ── Placement ───────────────────────────────────────────────────────

/**
 * The names of the components in `nodes` that do not belong there, where the
 * `allowed` ones go. A fragment passes its place on to its children.
 */
export function misplacedComponents(
  nodes: readonly RootContent[],
  allowed: Record<string, ClientComponentDef>,
  topLevel: Record<string, ClientComponentDef>,
): string[] {
  const check = (
    content: readonly RootContent[],
    defs: Record<string, ClientComponentDef>,
  ): string[] =>
    content.flatMap((node) => {
      if (!isJsxElement(node) || node.name === null)
        return "children" in node ? check(node.children, defs) : [];

      const def = defs[node.name];

      return def ? check(node.children, childComponents(def, topLevel)) : [node.name];
    });

  return check(nodes, allowed);
}
