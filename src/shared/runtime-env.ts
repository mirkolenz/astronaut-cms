import type { APIContext } from "astro";

/**
 * Reads a runtime environment variable across the runtimes the Astro adapters
 * target: the Cloudflare Workers binding (`locals.runtime.env`), Node, and Deno.
 * Shared by the injected server routes, which are the only code that may see a
 * secret and therefore the only code that reads the environment at all.
 */
export function readEnv(context: APIContext, name: string): string | undefined {
  const runtimeEnv = (context.locals as { runtime?: { env?: Record<string, string | undefined> } })
    .runtime?.env;

  if (runtimeEnv?.[name] != null) return runtimeEnv[name];

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

  if (proc?.env?.[name] != null) return proc.env[name];

  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;

  return deno?.env?.get(name);
}

/** How a platform-agnostic handler asks for a variable, without knowing about Astro. */
export type EnvReader = (name: string) => string | undefined;

export const envReader =
  (context: APIContext): EnvReader =>
  (name) =>
    readEnv(context, name);
