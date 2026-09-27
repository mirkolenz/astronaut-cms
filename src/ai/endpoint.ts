/**
 * Astro-route shell over the platform-agnostic relay in `handler.ts`. It supplies
 * the static config (from the virtual modules) and a runtime env reader, then
 * delegates to `handle`. Keeping the core framework-independent lets a true edge
 * function reuse it later (see the note in `handler.ts`).
 */
import type { APIContext, APIRoute } from "astro";
import config from "virtual:astronaut-cms/config";
import gatewayConfig from "virtual:astronaut-cms/ai-server";
import { handle } from "./handler.ts";

export const prerender = false;

// Reads a runtime env var across the runtimes the Astro adapters target: the
// Cloudflare Workers binding (locals.runtime.env), Node (process.env), and Deno.
function readEnv(context: APIContext, name: string): string | undefined {
  const runtimeEnv = (context.locals as { runtime?: { env?: Record<string, string | undefined> } })
    .runtime?.env;
  if (runtimeEnv?.[name] != null) return runtimeEnv[name];

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env?.[name] != null) return proc.env[name];

  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;

  return deno?.env?.get(name);
}

export const POST: APIRoute = (context) =>
  handle(context.request, (name) => readEnv(context, name), {
    storageType: config.storageType,
    github: config.github,
    gitlab: config.gitlab,
    gateway: gatewayConfig,
    models: config.ai?.models,
  });
