/**
 * `document.modelContext`, the WebMCP tool-registration API.
 *
 * Hand-written because no official package ships these types: the W3C proposal
 * is not in `lib.dom`, and the MCP TypeScript SDK describes the protocol rather
 * than this browser API. Only what the binding actually calls is declared, so
 * there is no unused surface to keep in step with a moving spec.
 *
 * Mirrors the WebIDL in https://webmachinelearning.github.io/webmcp/. A module
 * rather than an ambient `.d.ts` so the declarations are imported where they are
 * used and every compiler in the build sees them, not just the one configured
 * to sweep up loose declaration files.
 */

/** Hints an agent may act on before calling a tool. */
export interface WebmcpToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

export interface WebmcpTextContent {
  type: "text";
  text: string;
}

export interface WebmcpToolResult {
  content: WebmcpTextContent[];
}

export interface WebmcpTool {
  /** 1–128 characters of ASCII alphanumerics, underscore, hyphen or period. */
  name: string;
  title?: string;
  description: string;
  /** JSON Schema for the arguments. Absent means the tool takes none. */
  inputSchema?: object;
  annotations?: WebmcpToolAnnotations;
  execute: (
    input: unknown,
    options: { signal: AbortSignal },
  ) => WebmcpToolResult | Promise<WebmcpToolResult>;
}

export interface WebmcpRegisterToolOptions {
  /** Origins allowed to see the tool. Same-origin only when omitted. */
  exposedTo?: string[];
  /** Aborting it unregisters the tool. */
  signal?: AbortSignal;
}

export interface WebmcpModelContext extends EventTarget {
  registerTool(tool: WebmcpTool, options?: WebmcpRegisterToolOptions): Promise<void>;
}

declare global {
  interface Document {
    /**
     * Undefined in every browser that has not shipped WebMCP, and in Chrome
     * without the origin trial token or `chrome://flags/#enable-webmcp-testing`.
     */
    readonly modelContext?: WebmcpModelContext;
  }
}
