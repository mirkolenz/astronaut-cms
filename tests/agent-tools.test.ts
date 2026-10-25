import { describe, expect, it } from "vitest";
import { z } from "zod";
import { INVALIDATIONS } from "@/client/lib/query-keys";
import { operations } from "@/server/operations";
import { ContentValidationError, diagnostic } from "@/shared/diagnostics";
import { READ_ONLY_OPERATIONS, isWriteOperation } from "@/shared/operations";
import { client } from "virtual:astronaut-cms/server";
import { components } from "virtual:astronaut-cms/user-config";
import { createCmsTools } from "@/shared/tools/catalog";
import { TOOL_NAME_PATTERN, unexposable } from "@/shared/tools/exposable";
import type { CmsCall, CmsToolSet, ToolConfig } from "@/shared/tools/types";

const config: ToolConfig = {
  media: client.media,
  contentI18n: null,
  collections: client.collections,
  // A block rendering a collection's entries, whose content is edited there.
  components: { ...components, Gallery: { ...components.Gallery!, collections: ["posts"] } },
};

const unreachable: CmsCall = () => Promise.reject(new Error("the server should not be reached"));

const catalog = (call: CmsCall = unreachable): CmsToolSet => createCmsTools({ call, config });

describe("the tool catalog", () => {
  // The WebMCP binding registers whatever is in the catalog. A collection whose
  // schema cannot be lowered to JSON Schema, or whose name the API refuses,
  // would otherwise only surface as a console warning in somebody's browser.
  it("is registrable, tool by tool", () => {
    for (const [name, tool] of Object.entries(catalog())) {
      expect(name).toMatch(TOOL_NAME_PATTERN);
      expect(tool.description.length, name).toBeGreaterThan(0);
      expect(() =>
        z.toJSONSchema(tool.inputSchema, { target: "draft-2020-12", io: "input" }),
      ).not.toThrow();
    }
  });

  // The hint is what an outside agent uses to decide a call is safe to try, so
  // it has to agree with the one statement of which operations only read.
  it("hints read-only exactly where the registry says so", () => {
    for (const [name, tool] of Object.entries(catalog())) {
      if (!Object.hasOwn(operations, name)) continue;

      expect(tool.annotations?.readOnly === true, name).toBe(READ_ONLY_OPERATIONS.has(name));
    }
  });

  // The whole point of a tool per collection: the agent is handed the real
  // content model rather than a free-form record it has to guess at.
  it("carries each collection's own fields into its write tool", () => {
    const schema = z.toJSONSchema(catalog().writeEntry_posts!.inputSchema, { io: "input" });

    expect(schema).toMatchObject({
      properties: { data: { properties: { title: { type: "string" } } } },
    });
  });

  // Without them an agent can only imitate existing bodies: the content model
  // says where each component may go, and its props are handed out on demand.
  it("describes the MDX components a body may use", async () => {
    const tools = catalog();

    await expect(tools.getContentModel!.execute({})).resolves.toMatchObject({
      components: {
        Gallery: { kind: "block", collections: ["posts"], children: { Tile: { label: "Tile" } } },
      },
    });
    await expect(tools.getComponents!.execute({ names: ["Tile"] })).resolves.toEqual({
      Tile: {
        props: expect.objectContaining({ required: ["src", "alt"] }),
      },
    });
  });

  // A refusal the content caused says what to fix, so the agent corrects and
  // retries; only a real failure should end the call. Guarding the catalog as a
  // whole is what covers the read an edit derives its patch from.
  it("answers a refused call rather than failing", async () => {
    const refusing: CmsCall = () =>
      Promise.reject(new ContentValidationError([diagnostic("Title is required.")]));
    const tools = catalog(refusing);

    for (const tool of [tools.deleteEntry!, tools.editEntry_posts!]) {
      await expect(tool.execute({ collection: "posts", id: "hello" })).resolves.toHaveProperty(
        "error",
        expect.stringContaining("Title is required."),
      );
    }
  });
});

// A gateway rejects the whole request over one bad tool name, so a single
// collection the CMS is perfectly happy with would otherwise take the assistant
// down. Caught at build, where the person who can rename it is looking.
it("refuses a collection no tool can be named after", () => {
  const col = client.collections.posts!;

  expect(unexposable("posts", col)).toBeNull();
  expect(unexposable("blog posts", col)).toMatch(/not a usable tool name/);
  expect(unexposable("news.de", col)).toMatch(/not a usable tool name/);
  // `writeEntry_` counts towards the 64 characters, which is the part a name
  // just under the limit would otherwise pass.
  expect(unexposable("a".repeat(60), col)).toMatch(/not a usable tool name/);
});

// Stated per operation rather than per call site, so the assistant and any agent
// reaching the same operations over WebMCP age the cache too. A write missing
// here leaves the open admin showing content it just replaced.
it("states what every write operation ages", () => {
  expect(Object.keys(INVALIDATIONS).sort()).toEqual(
    Object.keys(operations).filter(isWriteOperation).sort(),
  );
});
