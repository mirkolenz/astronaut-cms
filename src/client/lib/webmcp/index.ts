/**
 * The CMS's tools, as an agent running in the browser reaches them.
 *
 * WebMCP (`document.modelContext`) lets the page hand an agent callable tools
 * instead of a DOM to scrape. The agent is the user's — the browser's own, or
 * one they installed — so it acts inside this tab with exactly the editor's
 * session and no credential of ours, and every guarantee the in-app assistant
 * runs under holds unchanged: nothing publishes, a write joins the pending
 * changeset, and the server refuses to remove or move a file content still
 * references.
 *
 * What does *not* carry over is the assistant's system prompt. An outside agent
 * is told only what the tool list says, which is why the catalog's descriptions
 * and its `getContentModel` tool do that work.
 *
 * The official MCP TypeScript SDK is deliberately not used here: it implements
 * the protocol (transports, JSON-RPC framing, a server that refuses to register
 * capabilities once connected), and WebMCP needs none of that — the browser is
 * the transport. It stays the right dependency for a future MCP *server*
 * projecting the same catalog.
 */
import { useEffect } from "react";
import { z } from "zod";
import config from "@/client/lib/config";
import { cmsToolCatalog } from "@/client/lib/tools";
import { TOOL_NAME_PATTERN } from "@/shared/tools/exposable";
import type { AnyCmsTool, ToolAnnotations } from "@/shared/tools/types";
import type { WebmcpModelContext, WebmcpToolAnnotations, WebmcpToolResult } from "./types";

const asResult = (value: unknown): WebmcpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

/**
 * The agent's arguments, checked before they reach an operation.
 *
 * The AI SDK validates a tool call against its schema for us. Here nothing does:
 * WebMCP hands `execute` whatever the agent sent, so the schema is the only
 * thing between an outside agent and the CMS, and a rejection is reported as a
 * result the agent can correct rather than as a failure.
 */
async function run(tool: AnyCmsTool, input: unknown): Promise<WebmcpToolResult> {
  const parsed = tool.inputSchema.safeParse(input ?? {});

  if (!parsed.success) {
    return asResult({ error: `Invalid arguments: ${z.prettifyError(parsed.error)}` });
  }

  return asResult(await tool.execute(parsed.data));
}

// The catalog states what a tool does in the CMS's terms; these are WebMCP's
// words for the same three facts.
const toHints = ({
  readOnly,
  destructive,
  untrustedOutput,
}: ToolAnnotations): WebmcpToolAnnotations => ({
  readOnlyHint: readOnly === true,
  consequentialHint: destructive === true,
  untrustedContentHint: untrustedOutput === true,
});

async function register(
  context: WebmcpModelContext,
  name: string,
  tool: AnyCmsTool,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (!TOOL_NAME_PATTERN.test(name)) throw new Error("not a usable tool name");

    await context.registerTool(
      {
        name,
        title: tool.title,
        description: tool.description,
        // `io: "input"` so a field carrying a default reads as optional, which is
        // what the agent is being asked to fill in.
        inputSchema: z.toJSONSchema(tool.inputSchema, {
          target: "draft-2020-12",
          io: "input",
        }),
        annotations: toHints(tool.annotations ?? {}),
        execute: (input) => run(tool, input),
      },
      // Same-origin only: `exposedTo` is deliberately unset, so nothing off this
      // origin can see the CMS's tools, let alone call one.
      { signal },
    );
  } catch (error) {
    // A net rather than the defence: the catalog leaves out what it cannot
    // offer, and the integration says so at build. What is left is a spec that
    // moved under us, which must not cost the rest of the catalog.
    console.error(`[astronaut-cms] Could not expose "${name}" over WebMCP:`, error);
  }
}

/**
 * Exposes the catalog, or does nothing where WebMCP is absent — every browser
 * that has not shipped it, and Chrome without the origin trial token or
 * `chrome://flags/#enable-webmcp-testing`. Aborting `signal` unregisters
 * everything it registered.
 */
async function registerAll(signal: AbortSignal): Promise<void> {
  const context = document.modelContext;

  if (!context || signal.aborted) return;

  await Promise.all(
    Object.entries(cmsToolCatalog).map(([name, tool]) => register(context, name, tool, signal)),
  );
}

/**
 * Keeps the tools registered for as long as the admin is mounted. Signed in is
 * the whole of the condition beyond the config: the tools do nothing the editor
 * could not do in the UI, and they reach the CMS through the same session.
 */
export function useWebmcpTools(): void {
  useEffect(() => {
    // The integration emits this key only when `webmcp.enabled` is set, so its
    // presence is the whole of the switch — and reading it here keeps the one
    // statement of it in the module that owns the feature.
    if (!config.webmcp) return;

    const controller = new AbortController();

    void registerAll(controller.signal);

    return () => controller.abort();
  }, []);
}
