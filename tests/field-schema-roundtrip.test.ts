import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToFieldSchema } from "@/shared/zod-to-field";
import { CMS_IMAGE, CMS_REFERENCE } from "@/shared/field-schema";
import { libraryImage, localizedMarker, repoImageMarker } from "@/shared/cms-markers";
import { fieldSchemaToZod } from "@/shared/field-to-zod";
import type { FieldSchema } from "@/shared/field-schema";

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
    expect(zodToFieldSchema(z.enum({ one: 1, two: 2 }))).toEqual({ type: "enum", options: [1, 2] });
    expect(zodToFieldSchema(z.literal("x"))).toEqual({ type: "literal", value: "x" });
    expect(zodToFieldSchema(z.literal(null))).toEqual({ type: "literal", value: null });
    expect(() => zodToFieldSchema(z.literal(undefined))).toThrow(/CMS schema literals/);
  });

  it("lays a localized value out by the content languages, the default one required", () => {
    const i18n = { locales: ["de", "en"], defaultLocale: "de" };
    const field = zodToFieldSchema(localizedMarker(z.string()), i18n);

    expect(field).toEqual({
      type: "object",
      strict: true,
      localized: true,
      shape: { de: { type: "string" }, en: { type: "string", optional: true } },
    });
    expect(fieldSchemaToZod(field).safeParse({ en: "Hi" }).success).toBe(false);
    expect(fieldSchemaToZod(field).safeParse({ de: "Hallo", fr: "Salut" }).success).toBe(false);
    expect(zodToFieldSchema(localizedMarker(z.string()))).toMatchObject({ type: "record" });
    expect(zodToFieldSchema(z.strictObject({}))).toEqual({ type: "object", shape: {}, strict: true });
  });

  it("reads how a field is presented from its meta", () => {
    expect(zodToFieldSchema(z.string().optional().meta({ multiline: true }))).toEqual({
      type: "string",
      optional: true,
      multiline: true,
    });
    expect(zodToFieldSchema(z.enum(["a", "b"]).meta({ labels: { a: "Alpha" } }))).toEqual({
      type: "enum",
      options: ["a", "b"],
      labels: { a: "Alpha" },
    });
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

  // A wrapper that changes what the schema accepts is not transparent: seeing
  // through it makes the browser validator disagree with the real Astro schema,
  // in whichever direction the wrapper leans.
  it("keeps nonoptional required and represents a catch fallback", () => {
    expect(zodToFieldSchema(z.string().optional().nonoptional())).toEqual({ type: "string" });
    expect(zodToFieldSchema(z.string().catch("fallback"))).toEqual({
      type: "string",
      catch: true,
    });
  });

  it("reads CMS asset / reference markers from meta", () => {
    expect(zodToFieldSchema(z.string().meta({ [CMS_IMAGE]: true }))).toEqual({ type: "image" });
    expect(zodToFieldSchema(z.string().meta({ [CMS_REFERENCE]: "posts" }))).toEqual({
      type: "reference",
      collection: "posts",
    });
  });

  // Astro's own collection image() only ever imports a repository file, while
  // libraryImage wraps it to take an object-store URL as well.
  it("tells a repository image field from one that takes either library", () => {
    expect(zodToFieldSchema(repoImageMarker())).toEqual({ type: "image", repoOnly: true });
    expect(zodToFieldSchema(libraryImage(repoImageMarker).optional())).toEqual({
      type: "image",
      optional: true,
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

  // Astro repairs a caught field rather than rejecting it, so a CMS that rebuilt
  // it as a required string would refuse content the site accepts.
  it("rebuilds a caught field as one that cannot fail", () => {
    const rebuilt = fieldSchemaToZod(zodToFieldSchema(z.object({ a: z.string().catch("x") })));

    // The fallback itself is not reconstructed, only the fact that nothing here
    // can fail, which is all any caller reads.
    expect(rebuilt.safeParse({}).success).toBe(true);
    expect(rebuilt.safeParse({ a: 1 }).success).toBe(true);
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

  it("preserves numeric, boolean, and null enum values", () => {
    const numeric = zodToFieldSchema(z.enum({ count: 1, none: 0 }));
    const rebuilt = fieldSchemaToZod({ type: "enum", options: [1, true, null] });

    expect(numeric).toEqual({ type: "enum", options: [1, 0] });
    expect(rebuilt.safeParse(1).success).toBe(true);
    expect(rebuilt.safeParse(true).success).toBe(true);
    expect(rebuilt.safeParse(null).success).toBe(true);
    expect(rebuilt.safeParse("1").success).toBe(false);
  });

  it("round-trips a null literal without changing it into text", () => {
    const rebuilt = fieldSchemaToZod(zodToFieldSchema(z.literal(null)));

    expect(rebuilt.safeParse(null).success).toBe(true);
    expect(rebuilt.safeParse("null").success).toBe(false);
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

  it("keeps length constraints on formatted strings", () => {
    const email = fieldSchemaToZod(zodToFieldSchema(z.email().min(10)));
    const url = fieldSchemaToZod(zodToFieldSchema(z.url().max(24)));

    expect(email.safeParse("a@b.com").success).toBe(false);
    expect(email.safeParse("alice@b.com").success).toBe(true);
    expect(url.safeParse("https://example.com").success).toBe(true);
    expect(url.safeParse("https://example.com/a-long-path").success).toBe(false);
  });
});

// The reconstructed schema is what the AI tools expose as JSON Schema, so a
// check that lowers to a large regex costs context on every call and cannot be
// compiled by grammar-constrained samplers (llama.cpp rejects the request
// outright). Dates and emails keep their strictness as refinements instead.
describe("tool JSON Schema stays simple", () => {
  const jsonSchema = (field: FieldSchema) =>
    z.toJSONSchema(z.object({ f: fieldSchemaToZod(field) }), {
      io: "input",
      unrepresentable: "any",
    });

  it("emits no regex for dates and emails", () => {
    for (const field of [{ type: "date" }, { type: "string", format: "email" }] as FieldSchema[]) {
      expect(JSON.stringify(jsonSchema(field))).not.toContain("pattern");
    }
  });

  it("still rejects values those checks exist for", () => {
    expect(fieldSchemaToZod({ type: "date" }).safeParse("next week").success).toBe(false);
    expect(fieldSchemaToZod({ type: "date" }).safeParse("2026-01-31").success).toBe(true);
    expect(fieldSchemaToZod({ type: "string", format: "email" }).safeParse("nope").success).toBe(
      false,
    );
    expect(fieldSchemaToZod({ type: "string", format: "email" }).safeParse("a@b.com").success).toBe(
      true,
    );
  });

  it("carries a field's title and description ahead of its type's own hint", () => {
    expect(
      jsonSchema({ type: "file", label: "Flyer", description: "The PDF to download." }),
    ).toMatchObject({
      properties: {
        f: {
          title: "Flyer",
          description: expect.stringMatching(/^The PDF to download\.\n.*listMedia/),
        },
      },
    });
  });

  it("keeps a pattern the schema author wrote themselves", () => {
    expect(JSON.stringify(jsonSchema({ type: "string", pattern: "^[a-z]+$" }))).toContain(
      "pattern",
    );
  });
});
