/**
 * Remark plugin that auto-imports local assets referenced in MDX files.
 *
 * Two detection strategies:
 * 1. **Schema-driven** (JSX component props): uses the asset fields map
 *    (extracted from Zod metadata at integration setup) to know exactly
 *    which props hold image()/file() values. No extension guessing.
 * 2. **Extension-based** (markdown links): `[text](path)` where path matches
 *    known asset extensions. This is the only place extension matching is
 *    needed since markdown syntax has no schema. Neither Astro, remark-rehype,
 *    nor Vite resolve `<a href>` as an asset source, so without this strategy
 *    relative links to co-located files would break in production builds.
 *    See https://github.com/vitejs/vite/issues/19918
 *
 * For each detected local path the plugin generates an ES `import` statement
 * and rewrites the reference so Vite includes the file in the build output.
 */

import { visit, SKIP } from "unist-util-visit";
import type { Root } from "mdast";
import type {
  MdxJsxFlowElement,
  MdxJsxTextElement,
  MdxJsxAttributeValueExpression,
} from "mdast-util-mdx-jsx";
import type { MdxjsEsm } from "mdast-util-mdxjs-esm";
import type { ImportDeclaration } from "estree";

/** Maps component name -> prop name -> "image" | "file". */
export type AssetFieldsMap = Record<string, Record<string, "image" | "file">>;

const ASSET_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|docx?|xlsx?|pptx?|zip|csv)$/i;

const NON_LOCAL_RE = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;

function isLocalPath(value: string): boolean {
  return !!value && !NON_LOCAL_RE.test(value);
}

type MdxJsxElement = MdxJsxFlowElement | MdxJsxTextElement;

function isMdxJsxElement(node: { type: string }): node is MdxJsxElement {
  return node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
}

/** Builds `import name from "path"` as an mdxjsEsm AST node. */
function esmImportNode(name: string, path: string): MdxjsEsm {
  const decl: ImportDeclaration = {
    type: "ImportDeclaration",
    source: { type: "Literal", value: path, raw: JSON.stringify(path) },
    specifiers: [
      {
        type: "ImportDefaultSpecifier",
        local: { type: "Identifier", name },
      },
    ],
    attributes: [],
  };
  return {
    type: "mdxjsEsm",
    value: "",
    data: { estree: { type: "Program", sourceType: "module", body: [decl] } },
  };
}

/** Builds `{name}` as an MDX JSX attribute expression value. */
function jsxExpressionValue(name: string): MdxJsxAttributeValueExpression {
  return {
    type: "mdxJsxAttributeValueExpression",
    value: name,
    data: {
      estree: {
        type: "Program",
        sourceType: "module",
        body: [
          {
            type: "ExpressionStatement",
            expression: { type: "Identifier", name },
          },
        ],
      },
    },
  };
}

export function remarkCmsAssets(assetFieldsMap: AssetFieldsMap) {
  return (tree: Root) => {
    const imports = new Map<string, string>();

    function importRef(path: string): string {
      let name = imports.get(path);
      if (!name) {
        name = `__cms_asset_${imports.size}__`;
        imports.set(path, name);
      }
      return name;
    }

    // Schema-driven: rewrite JSX component props marked as image()/file()
    visit(tree, (node) => {
      if (!isMdxJsxElement(node)) return;

      const fields = node.name ? assetFieldsMap[node.name] : undefined;
      if (!fields) return;

      for (const attr of node.attributes) {
        if (attr.type !== "mdxJsxAttribute") continue;
        if (typeof attr.value !== "string") continue;
        if (!fields[attr.name]) continue;
        if (!isLocalPath(attr.value)) continue;

        attr.value = jsxExpressionValue(importRef(attr.value));
      }
    });

    // Extension-based: rewrite markdown links to local asset files
    visit(tree, "link", (node, index, parent) => {
      if (parent == null || index == null) return;
      if (!isLocalPath(node.url) || !ASSET_EXT_RE.test(node.url)) return;

      const replacement: MdxJsxTextElement = {
        type: "mdxJsxTextElement",
        name: "a",
        attributes: [
          {
            type: "mdxJsxAttribute",
            name: "href",
            value: jsxExpressionValue(importRef(node.url)),
          },
        ],
        children: node.children,
      };
      parent.children[index] = replacement as (typeof parent.children)[number];
      return SKIP;
    });

    // Prepend collected import declarations
    for (const [path, name] of imports) {
      tree.children.unshift(esmImportNode(name, path));
    }
  };
}
