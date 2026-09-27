/**
 * The tool catalog as the in-app assistant's AI SDK sees it.
 *
 * One of three projections of the same object (the WebMCP surface is another, an
 * MCP server would be a third), and the thinnest: the SDK already speaks Zod
 * schemas and async functions, so nothing is translated here beyond dropping the
 * metadata it has no slot for. It validates a tool call against the schema
 * itself, which is why this binding does not.
 */
import { tool, type ToolSet } from "ai";
import { cmsToolCatalog } from "@client/lib/tools";

export const cmsTools: ToolSet = Object.fromEntries(
  Object.entries(cmsToolCatalog).map(([name, cmsTool]) => [
    name,
    tool({
      description: cmsTool.description,
      inputSchema: cmsTool.inputSchema,
      execute: (input) => cmsTool.execute(input),
    }),
  ]),
);
