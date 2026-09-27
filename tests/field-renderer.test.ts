import { Children, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { FieldSchema } from "@/shared/field-schema";
import { FieldRenderer, getDefaultValue } from "@/client/components/editors/field-renderer";

// FieldRenderer dispatches each FieldSchema variant to a dedicated editor and
// uses no hooks itself, so we can call it as a plain function and read which
// component it returned. This guards the switch: a new FieldSchema type added
// without a matching case silently falls through to the raw FallbackField, and
// that regression shows up here as the wrong component name.
function dispatch(schema: FieldSchema): string {
  const element = FieldRenderer({ schema, value: undefined, onChange: () => {}, name: "field" });

  return ((element as ReactElement).type as { name: string }).name;
}

describe("FieldRenderer dispatch", () => {
  const cases: [string, FieldSchema, string][] = [
    ["image", { type: "image" }, "ImageField"],
    ["file", { type: "file" }, "FileField"],
    ["reference", { type: "reference", collection: "posts" }, "ReferenceField"],
    ["string", { type: "string" }, "StringField"],
    ["string (email)", { type: "string", format: "email" }, "StringField"],
    ["string (long)", { type: "string", maxLength: 500 }, "TextareaField"],
    ["number", { type: "number" }, "NumberField"],
    ["boolean", { type: "boolean" }, "BooleanField"],
    ["date", { type: "date" }, "DateField"],
    ["enum", { type: "enum", options: ["a", "b"] }, "EnumField"],
    ["array", { type: "array", element: { type: "string" } }, "ArrayField"],
    ["tuple", { type: "tuple", items: [{ type: "string" }, { type: "number" }] }, "TupleField"],
    ["object", { type: "object", shape: { a: { type: "string" } } }, "ObjectField"],
    ["record", { type: "record", value: { type: "string" } }, "RecordField"],
    [
      "discriminated union",
      {
        type: "union",
        discriminator: "kind",
        variants: [
          { type: "object", shape: { kind: { type: "literal", value: "a" } } },
          { type: "object", shape: { kind: { type: "literal", value: "b" } } },
        ],
      },
      "UnionField",
    ],
  ];

  it.each(cases)("renders a dedicated editor for %s", (_label, schema, expected) => {
    expect(dispatch(schema)).toBe(expected);
  });

  it("falls back to the raw editor only for unsupported shapes", () => {
    expect(dispatch({ type: "literal", value: "x" })).toBe("FallbackField");
    expect(dispatch({ type: "unknown" })).toBe("FallbackField");
    // A plain (non-discriminated) union has no selector key, so it degrades too.
    expect(dispatch({ type: "union", variants: [{ type: "string" }, { type: "number" }] })).toBe(
      "FallbackField",
    );
  });
});

it("keeps enum options with identical labels distinct and preserves their value types", () => {
  const options = ["1", 1, true, null];
  const selected: unknown[] = [];
  const props = {
    schema: { type: "enum", options } satisfies FieldSchema,
    value: 1,
    onChange: (value: unknown) => selected.push(value),
    name: "choice",
  };
  const editor = FieldRenderer(props) as ReactElement<typeof props>;
  const render = editor.type as (value: typeof editor.props) => ReactElement<{ children: ReactNode }>;
  const selectOf = (value: unknown) => {
    const element = FieldRenderer({ ...props, value }) as ReactElement<typeof props>;
    const field = render(element.props);

    return Children.toArray(field.props.children)[1] as ReactElement<{
      value: string;
      onValueChange: (index: string) => void;
      children: ReactNode;
    }>;
  };

  const select = selectOf(1);
  const content = Children.toArray(select.props.children)[1] as ReactElement<{ children: ReactNode }>;
  const items = Children.toArray(content.props.children) as ReactElement<{ value: string }>[];

  expect(select.props.value).toBe("1");
  expect(items.map((item) => item.props.value)).toEqual(["0", "1", "2", "3"]);
  expect(selectOf(null).props.value).toBe("3");

  for (const index of ["0", "1", "2", "3"]) select.props.onValueChange(index);

  expect(selected).toEqual(options);
});

describe("getDefaultValue", () => {
  it("returns an empty string when there is no schema", () => {
    expect(getDefaultValue()).toBe("");
  });

  it("prefers an explicit default, then null for optional/nullable", () => {
    expect(getDefaultValue({ type: "number", default: 7 })).toBe(7);
    expect(getDefaultValue({ type: "string", optional: true })).toBeNull();
    expect(getDefaultValue({ type: "string", nullable: true })).toBeNull();
  });

  it("produces a typed default per primitive", () => {
    expect(getDefaultValue({ type: "string" })).toBe("");
    expect(getDefaultValue({ type: "number" })).toBe(0);
    expect(getDefaultValue({ type: "boolean" })).toBe(false);
    expect(getDefaultValue({ type: "enum", options: ["a", "b"] })).toBe("a");
    expect(getDefaultValue({ type: "enum", options: [null, 1] })).toBeNull();
    expect(getDefaultValue({ type: "literal", value: "x" })).toBe("x");
    expect(typeof getDefaultValue({ type: "date" })).toBe("string");
  });

  it("builds a full-length default for a tuple", () => {
    expect(
      getDefaultValue({ type: "tuple", items: [{ type: "string" }, { type: "number" }] }),
    ).toEqual(["", 0]);
  });

  it("omits optional keys from an object default", () => {
    expect(
      getDefaultValue({
        type: "object",
        shape: { a: { type: "string" }, b: { type: "number", optional: true } },
      }),
    ).toEqual({ a: "" });
  });

  it("uses the first variant for a union default", () => {
    expect(
      getDefaultValue({ type: "union", variants: [{ type: "number" }, { type: "string" }] }),
    ).toBe(0);
  });
});
