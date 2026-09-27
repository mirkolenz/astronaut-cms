/**
 * What the CMS offers an agent, stated once and bound to a protocol elsewhere.
 *
 * The in-app assistant reaches these tools through the AI SDK, an agent in the
 * browser reaches them through WebMCP, and an MCP server would reach them
 * through the official SDK. None of those vocabularies appears here: a tool is a
 * name, a description, a Zod schema and a function, and each binding projects
 * that into its own shape. Adding a protocol is a new binding and no change to
 * the tools.
 */
import type { z } from "zod";
import type { CmsCall } from "../../server/operations.ts";
import type { ContentI18n } from "../i18n.ts";
import type { ClientMediaConfig } from "../media.ts";
import type { CollectionManifest } from "../types.ts";

/**
 * How a tool reaches the CMS, which is the operation registry and nothing else.
 * Re-exported so a binding needs only this module, and a type-only import so
 * none of the server reaches a browser bundle.
 */
export type { CmsCall };

/** What the tools need to know about the deployment beyond what they can ask it. */
export interface ToolConfig {
  media: ClientMediaConfig;
  contentI18n: ContentI18n | null;
  collections: CollectionManifest;
}

export interface ToolContext {
  call: CmsCall;
  config: ToolConfig;
}

/**
 * What an agent learns about a tool before calling one, in the CMS's own terms
 * rather than a protocol's: WebMCP spells the second one `consequentialHint` and
 * MCP spells it `destructiveHint`, and only the binding needs to know that.
 */
export interface ToolAnnotations {
  /** Calling it changes nothing, so trying it is always safe. */
  readOnly?: boolean;
  /** It removes or moves something a human would want to have agreed to. */
  destructive?: boolean;
  /** Its result carries editor-authored text, which is data and never instruction. */
  untrustedOutput?: boolean;
}

export interface CmsTool<Schema extends z.ZodType = z.ZodType> {
  /** Short human label, for an agent that shows one rather than the name. */
  title: string;
  description: string;
  inputSchema: Schema;
  /** Absent where a tool is an ordinary write: nothing to hint at. */
  annotations?: ToolAnnotations;
  /**
   * Declared as a method rather than a property so a tool with a narrow input
   * stays assignable to the erased {@link AnyCmsTool} the bindings iterate over.
   * Every binding parses its input through `inputSchema` before calling, which
   * is what makes that sound.
   *
   * The result is `unknown` because no binding reads it as anything else: WebMCP
   * serializes it, the AI SDK hands it back to the model.
   */
  execute(input: z.output<Schema>): Promise<unknown>;
}

export type AnyCmsTool = CmsTool;

/** The catalog, as a binding receives it. */
export type CmsToolSet = Record<string, AnyCmsTool>;

/** A refusal the content caused, which is an answer rather than a failure. */
export interface ToolRefusal {
  error: string;
}

export const isRefusal = (value: unknown): value is ToolRefusal =>
  typeof value === "object" && value !== null && "error" in value;

/**
 * Identity, for its inference: it pins `Schema` from `inputSchema` so `execute`
 * receives that schema's parsed output instead of an implicit `any`. Mirrors
 * `defineComponent` in the public config.
 */
export function defineTool<Schema extends z.ZodType>(tool: CmsTool<Schema>): CmsTool<Schema> {
  return tool;
}
