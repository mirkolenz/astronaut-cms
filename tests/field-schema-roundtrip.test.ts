import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToFieldSchema } from "@shared/zod-to-field";
import { CMS_IMAGE, CMS_REFERENCE } from "@shared/field-schema";
import { fieldSchemaToZod } from "@client/lib/ai/schema";

// The browser reconstructs a live Zod validator from the serialized FieldSchema
// that Node lowered. These tests pin the full round-trip: lowering must capture
// the structure, and reconstruction must rebuild a validator with the same
// accept/reject behavior. A gap in either direction (a dropped discriminator, a
// missing tuple case) shows up here as a failing assertion.

describe("zodToFieldSchema lowering", () => {
  it("captures primitive types and their modifiers", () => {
    expect(zodToFieldSchema(z.string())).toEqual({ type: "string" });
    expect(zodToFieldSchema(z.string().max(5))).toEqual({ type: "string", maxLength: 5 });
    expect(zodToFieldSchema(z.email())).toEqual({ type: "string", format: "email" });
    expect(zodToFieldSchema(z.url())).toEqual({ type: "string", format: "url" });
    expect(zodToFieldSchema(z.number())).toEqual({ type: "number" });
    expect(zodToFieldSchema(z.int())).toEqual({ type: "number", integer: true });
    expect(zodToFieldSchema(z.boolean())).toEqual({ type: "boolean" });
    expect(zodToFieldSchema(z.date())).toEqual({ type: "date" });
    expect(zodToFieldSchema(z.enum(["a", "b"]))).toEqual({ type: "enum", options: ["a", "b"] });
    expect(zodToFieldSchema(z.literal("x"))).toEqual({ type: "literal", value: "x" });
  });

  it("threads optional / nullable / default flags onto the base type", () => {
    expect(zodToFieldSchema(z.string().optional())).toMatchObject({
      type: "string",
      optional: true,
    });
    expect(zodToFieldSchema(z.string().nullable())).toMatchObject({
      type: "string",
      nullable: true,
    });
    expect(zodToFieldSchema(z.string().default("hi"))).toMatchObject({
      type: "string",
      default: "hi",
    });
  });

  it("reads CMS asset / reference markers from meta", () => {
    expect(zodToFieldSchema(z.string().meta({ [CMS_IMAGE]: true }))).toEqual({ type: "image" });
    expect(zodToFieldSchema(z.string().meta({ [CMS_REFERENCE]: "posts" }))).toEqual({
      type: "reference",
      collection: "posts",
    });
  });

  it("lowers a tuple to a positional item list", () => {
    expect(zodToFieldSchema(z.tuple([z.string(), z.int()]))).toEqual({
      type: "tuple",
      items: [{ type: "string" }, { type: "number", integer: true }],
    });
  });

  it("keeps the discriminator only for discriminated unions", () => {
    const discriminated = zodToFieldSchema(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), a: z.string() }),
        z.object({ kind: z.literal("b"), b: z.number() }),
      ]),
    );
    expect(discriminated).toMatchObject({ type: "union", discriminator: "kind" });

    const plain = zodToFieldSchema(z.union([z.string(), z.number()]));
    expect(plain.type).toBe("union");
    expect((plain as { discriminator?: string }).discriminator).toBeUndefined();
  });

  it("merges an intersection of objects into a single shape", () => {
    const merged = zodToFieldSchema(z.object({ a: z.string() }).and(z.object({ b: z.number() })));
    expect(merged).toEqual({
      type: "object",
      shape: { a: { type: "string" }, b: { type: "number" } },
    });
  });

  it("captures declarative string / number / array constraints", () => {
    expect(zodToFieldSchema(z.string().min(2).max(5))).toEqual({
      type: "string",
      minLength: 2,
      maxLength: 5,
    });
    expect(zodToFieldSchema(z.string().regex(/^[a-z]+$/))).toEqual({
      type: "string",
      pattern: "^[a-z]+$",
    });
    expect(zodToFieldSchema(z.number().min(0).max(10))).toEqual({
      type: "number",
      min: 0,
      max: 10,
    });
    expect(zodToFieldSchema(z.number().gt(0).lt(5))).toEqual({
      type: "number",
      exclusiveMin: 0,
      exclusiveMax: 5,
    });
    expect(zodToFieldSchema(z.int().multipleOf(2))).toEqual({
      type: "number",
      integer: true,
      multipleOf: 2,
    });
    // A plain integer must not leak the JS safe-integer range as bounds...
    expect(zodToFieldSchema(z.int())).toEqual({ type: "number", integer: true });
    // ...but real bounds on an integer survive.
    expect(zodToFieldSchema(z.int().min(0).max(10))).toEqual({
      type: "number",
      integer: true,
      min: 0,
      max: 10,
    });
    expect(zodToFieldSchema(z.array(z.string()).min(1).max(3))).toEqual({
      type: "array",
      element: { type: "string" },
      minItems: 1,
      maxItems: 3,
    });
  });
});

describe("fieldSchemaToZod reconstruction round-trip", () => {
  it("rebuilds a discriminated union as a discriminated union, not a plain one", () => {
    const original = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), value: z.string() }),
      z.object({ kind: z.literal("count"), value: z.int() }),
    ]);
    const rebuilt = fieldSchemaToZod(zodToFieldSchema(original));

    expect(rebuilt).toBeInstanceOf(z.ZodDiscriminatedUnion);
    expect(rebuilt.parse({ kind: "count", value: 3 })).toEqual({ kind: "count", value: 3 });
    // The wrong variant's value type must be rejected by the matched branch.
    expect(rebuilt.safeParse({ kind: "count", value: "nope" }).success).toBe(false);
  });

  it("keeps a plain union plain", () => {
    const rebuilt = fieldSchemaToZod(zodToFieldSchema(z.union([z.string(), z.number()])));

    expect(rebuilt).toBeInstanceOf(z.ZodUnion);
    expect(rebuilt).not.toBeInstanceOf(z.ZodDiscriminatedUnion);
    expect(rebuilt.parse("hello")).toBe("hello");
    expect(rebuilt.parse(42)).toBe(42);
    expect(rebuilt.safeParse(true).success).toBe(false);
  });

  it("round-trips a tuple's length and element types", () => {
    const rebuilt = fieldSchemaToZod(zodToFieldSchema(z.tuple([z.string(), z.int()])));

    expect(rebuilt).toBeInstanceOf(z.ZodTuple);
    expect(rebuilt.parse(["a", 2])).toEqual(["a", 2]);
    expect(rebuilt.safeParse(["a", 2.5]).success).toBe(false);
    expect(rebuilt.safeParse(["a"]).success).toBe(false);
  });

  it("round-trips a nested object with optional and nullable fields", () => {
    const original = z.object({
      title: z.string().max(10),
      tags: z.array(z.string()),
      meta: z.object({ views: z.int() }).optional(),
      author: z.string().nullable(),
    });
    const rebuilt = fieldSchemaToZod(zodToFieldSchema(original));

    expect(rebuilt.parse({ title: "hi", tags: ["x"], author: null })).toMatchObject({
      title: "hi",
    });
    expect(rebuilt.safeParse({ title: "way too long here", tags: [], author: null }).success).toBe(
      false,
    );
    expect(rebuilt.safeParse({ tags: [], author: null }).success).toBe(false);
  });

  it("reconstructs an enum that rejects unknown options", () => {
    const rebuilt = fieldSchemaToZod(zodToFieldSchema(z.enum(["draft", "published"])));

    expect(rebuilt.parse("draft")).toBe("draft");
    expect(rebuilt.safeParse("archived").success).toBe(false);
  });

  it("re-applies declarative constraints so the rebuilt validator still rejects", () => {
    const string = fieldSchemaToZod(zodToFieldSchema(z.string().min(2).max(4)));
    expect(string.safeParse("a").success).toBe(false);
    expect(string.safeParse("abc").success).toBe(true);
    expect(string.safeParse("abcde").success).toBe(false);

    const pattern = fieldSchemaToZod(zodToFieldSchema(z.string().regex(/^[a-z]+$/)));
    expect(pattern.safeParse("abc").success).toBe(true);
    expect(pattern.safeParse("ABC").success).toBe(false);

    const number = fieldSchemaToZod(zodToFieldSchema(z.number().min(0).max(10)));
    expect(number.safeParse(-1).success).toBe(false);
    expect(number.safeParse(11).success).toBe(false);

    const exclusive = fieldSchemaToZod(zodToFieldSchema(z.number().gt(0).lt(5)));
    expect(exclusive.safeParse(0).success).toBe(false);
    expect(exclusive.safeParse(3).success).toBe(true);
    expect(exclusive.safeParse(5).success).toBe(false);

    const multiple = fieldSchemaToZod(zodToFieldSchema(z.int().multipleOf(2)));
    expect(multiple.safeParse(3).success).toBe(false);
    expect(multiple.safeParse(4).success).toBe(true);

    const array = fieldSchemaToZod(zodToFieldSchema(z.array(z.string()).min(1)));
    expect(array.safeParse([]).success).toBe(false);
    expect(array.safeParse(["x"]).success).toBe(true);

    const email = fieldSchemaToZod(zodToFieldSchema(z.email()));
    expect(email.safeParse("a@b.com").success).toBe(true);
    expect(email.safeParse("nope").success).toBe(false);
  });
});
