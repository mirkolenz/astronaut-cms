/**
 * Reading and writing the value of an MDX component prop.
 *
 * An attribute is either a string literal (`title="x"`) or a braced JavaScript
 * expression (`title={'x'}`, `items={['a', 'b']}`). The second form is ordinary
 * JS, not JSON — single quotes, unquoted keys and trailing commas are all valid
 * — so it is parsed as such. Everything that reads a prop goes through here: the
 * schema-driven walk that validates a body and collects its assets, and the prop
 * editor in the admin, so the two cannot disagree about what a body says.
 *
 * Only literal data is evaluated. An expression that needs a runtime — an
 * identifier, a call, a template with substitutions — is reported as unknown,
 * which is what lets a caller leave it unchecked instead of guessing.
 */
import { parseExpressionAt } from "acorn";
import type { Expression, Property } from "estree";
import type { MdxJsxAttribute } from "mdast-util-mdx";

/** A statically-known attribute value, or `unknown` for one only a runtime has. */
export type StaticValue = { known: true; value: unknown } | { known: false };

const UNKNOWN: StaticValue = { known: false };

/** What an attribute is worth, with a bare `<C flag />` reading as `true`. */
export function attributeValue(attr: MdxJsxAttribute): StaticValue {
  const value = attr.value;

  if (value === null || value === undefined) return { known: true, value: true };

  if (typeof value === "string") return { known: true, value };

  try {
    return evaluate(parseExpressionAt(value.value, 0, { ecmaVersion: "latest" }) as Expression);
  } catch {
    return UNKNOWN;
  }
}

/** The attribute spelling a value, the inverse of {@link attributeValue}. */
export function valueToAttribute(name: string, value: unknown): MdxJsxAttribute {
  if (value === true) return { type: "mdxJsxAttribute", name, value: null };

  if (typeof value === "string") return { type: "mdxJsxAttribute", name, value };

  return {
    type: "mdxJsxAttribute",
    name,
    value: { type: "mdxJsxAttributeValueExpression", value: JSON.stringify(value) },
  };
}

function evaluate(node: Expression): StaticValue {
  switch (node.type) {
    case "Literal":
      return node.value instanceof RegExp ? UNKNOWN : { known: true, value: node.value };

    // A negative number is a unary minus over a literal, not a literal.
    case "UnaryExpression": {
      const argument = evaluate(node.argument);

      if (!argument.known) return UNKNOWN;
      if (node.operator === "-") return { known: true, value: -(argument.value as number) };
      if (node.operator === "!") return { known: true, value: !argument.value };

      return UNKNOWN;
    }

    case "TemplateLiteral":
      return node.expressions.length === 0
        ? { known: true, value: node.quasis[0]?.value.cooked }
        : UNKNOWN;

    case "ArrayExpression": {
      const items: unknown[] = [];

      for (const element of node.elements) {
        if (!element || element.type === "SpreadElement") return UNKNOWN;

        const item = evaluate(element);

        if (!item.known) return UNKNOWN;

        items.push(item.value);
      }

      return { known: true, value: items };
    }

    case "ObjectExpression": {
      const object: Record<string, unknown> = {};

      for (const property of node.properties) {
        if (property.type !== "Property" || property.computed) return UNKNOWN;

        const key = propertyKey(property);
        const item = evaluate(property.value as Expression);

        if (key === null || !item.known) return UNKNOWN;

        object[key] = item.value;
      }

      return { known: true, value: object };
    }

    default:
      return UNKNOWN;
  }
}

function propertyKey(property: Property): string | null {
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);

  return null;
}
