import { expectTypeOf, test } from "vitest";
import type * as Editor from "@/client/editor";
import type * as Stubs from "@/internal/editor-stubs";

test("the Node stand-ins cover every editor export", () => {
  expectTypeOf<keyof typeof Stubs>().toEqualTypeOf<keyof typeof Editor>();
});
