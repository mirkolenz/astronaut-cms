import { describe, expect, it } from "vitest";
import { fieldSchemaToZod } from "@/shared/field-to-zod";
import { zodToFieldSchema } from "@/shared/zod-to-field";
import { linkMarker } from "@/shared/cms-markers";
import { isAllowedLink, isLinkLike } from "@/shared/links";

// A component can render any string prop as an href, so a URL is only accepted
// where the schema declares one, and only one a visitor may safely follow.
describe("link policy", () => {
  it("allows only safe URLs in a link field", () => {
    for (const url of ["/contact", "#top", "../x", "https://a.b", "mailto:a@b.c", "tel:+491"]) {
      expect(isAllowedLink(url)).toBe(true);
    }

    for (const url of ["javascript:alert(1)", " JaVa\tScRiPt:x", "data:text/html,x", "ftp://a.b"]) {
      expect(isAllowedLink(url)).toBe(false);
    }
  });

  it("refuses plain text that would act as a link", () => {
    for (const text of ["https://a.b", "//evil.example", "\\\\evil.example", "mailto:a@b.c", "javascript: alert(1)", " DATA:text/html,x"]) {
      expect(isLinkLike(text)).toBe(true);
    }

    for (const text of ["Hello", "Case study: Acme", "ISBN:978-3-16", "Re:Invent", "/contact", "10:30"]) {
      expect(isLinkLike(text)).toBe(false);
    }
  });

  it("enforces the policy through the lowered schemas", () => {
    const link = fieldSchemaToZod(zodToFieldSchema(linkMarker()));
    const text = fieldSchemaToZod({ type: "string" });
    const url = fieldSchemaToZod({ type: "string", format: "url" });

    expect(link.safeParse("/contact").success).toBe(true);
    expect(link.safeParse("javascript:alert(1)").success).toBe(false);
    expect(text.safeParse("https://a.b").success).toBe(false);
    expect(url.safeParse("javascript:alert(1)").success).toBe(false);
    expect(linkMarker().safeParse("javascript:alert(1)").success).toBe(false);
  });
});
