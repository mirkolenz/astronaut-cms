import { describe, expect, it } from "vitest";
import type { MdxJsxElement } from "@/shared/jsx-editor";
import type { ClientComponentDef } from "@/internal/user-config";
import {
  childKey,
  duplicateChild,
  findAt,
  jsxChildren,
  misplacedComponents,
  missingProps,
  moveChild,
  newComponent,
  readProps,
  removeChild,
  updateAt,
  withProp,
  type JsxChild,
} from "@/client/lib/component-tree";

const feature: ClientComponentDef = {
  props: {
    type: "object",
    shape: { title: { type: "string" }, icon: { type: "enum", options: ["a", "b"], default: "a" } },
  },
  kind: "flow",
  source: null,
  defaultExport: false,
  label: "Feature",
  description: null,
  summary: null,
  icon: null,
  editor: null,
};

function grid(...titles: string[]): JsxChild {
  return {
    type: "mdxJsxFlowElement",
    name: "Grid",
    attributes: [],
    children: titles.map((title) => ({
      type: "mdxJsxFlowElement",
      name: "Feature",
      attributes: [{ type: "mdxJsxAttribute", name: "title", value: title }],
      children: [],
    })),
  };
}

const titles = (element: MdxJsxElement) => jsxChildren(element).map((child) => readProps(child).title);

// Structured children are addressed by keys rather than positions, so an edit
// through a key has to find the same child after the tree is cloned (as every
// Lexical node update does) and after its siblings moved.
describe("structured children", () => {
  it("keeps a child's key through clones and moves", () => {
    const root = grid("A", "B", "C");
    const [a, , c] = jsxChildren(root).map(childKey);
    const moved = moveChild(structuredClone(root), [], c!, 0);

    expect(titles(moved)).toEqual(["C", "A", "B"]);
    expect(findAt(moved, [a!]) && readProps(findAt(moved, [a!])!).title).toBe("A");

    const renamed = updateAt(moved, [a!], (child) => withProp(child, "title", "A2"));

    expect(titles(renamed)).toEqual(["C", "A2", "B"]);
  });

  it("duplicates a child under a key of its own, and removes one by key", () => {
    const root = grid("A", "B");
    const [a] = jsxChildren(root).map(childKey);
    const copied = duplicateChild(root, [], a!);
    const keys = jsxChildren(copied).map(childKey);

    expect(titles(copied)).toEqual(["A", "A", "B"]);
    expect(new Set(keys).size).toBe(3);
    expect(titles(removeChild(copied, [], a!))).toEqual(["A", "B"]);
  });

  it("writes a new child with its defaults and a key already set", () => {
    const child = newComponent("Feature", feature);

    expect(child.data?.cmsKey).toBeTypeOf("string");
    expect(readProps(child)).toEqual({ title: "", icon: "a" });
  });
});

describe("props", () => {
  it("rewrites only the prop it sets", () => {
    const element: MdxJsxElement = {
      type: "mdxJsxFlowElement",
      name: "Feature",
      attributes: [
        { type: "mdxJsxAttribute", name: "title", value: "A" },
        { type: "mdxJsxAttribute", name: "items", value: { type: "mdxJsxAttributeValueExpression", value: "list" } },
        { type: "mdxJsxExpressionAttribute", value: "...rest" },
      ],
      children: [],
    };
    const edited = withProp(element, "title", "B");

    expect(readProps(edited)).toEqual({ title: "B" });
    expect(edited.attributes[1]).toBe(element.attributes[1]);
    expect(edited.attributes[2]).toBe(element.attributes[2]);
    expect(readProps(withProp(edited, "title", undefined))).toEqual({});
  });

  it("reports required props without a value, unless a spread may supply them", () => {
    const empty: MdxJsxElement = { type: "mdxJsxFlowElement", name: "Feature", attributes: [], children: [] };

    expect(missingProps(feature, empty)).toEqual(["Title"]);
    expect(missingProps(feature, withProp(empty, "title", "A"))).toEqual([]);
    expect(
      missingProps(feature, { ...empty, attributes: [{ type: "mdxJsxExpressionAttribute", value: "...rest" }] }),
    ).toEqual([]);
  });
});

describe("placement", () => {
  it("reports components written where their definition does not allow them", () => {
    const top = { Grid: { ...feature, label: "Grid", children: { Feature: feature } } };

    expect(misplacedComponents([grid("A")], top, top)).toEqual([]);
    expect(misplacedComponents(grid("A").children, top, top)).toEqual(["Feature"]);
  });
});
