/**
 * The Cloudflare Workers environment, where the adapter puts one on `locals`.
 * The only place that knows this shape, so a reader of a variable and a reader
 * of a binding cannot disagree about where to look.
 */
export interface RuntimeContext {
  locals: unknown;
}

function runtimeEnv(context: RuntimeContext): Record<string, unknown> | undefined {
  return (context.locals as { runtime?: { env?: Record<string, unknown> } }).runtime?.env;
}

/**
 * Reads a runtime environment variable across the runtimes the Astro adapters
 * target: the Cloudflare Workers binding (`locals.runtime.env`), Node, and Deno.
 * Shared by the injected server routes, which are the only code that may see a
 * secret and therefore the only code that reads the environment at all.
 */
export function readEnv(context: RuntimeContext, name: string): string | undefined {
  const value = runtimeEnv(context)?.[name];

  if (typeof value === "string") return value;

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

  if (proc?.env?.[name] != null) return proc.env[name];

  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;

  return deno?.env?.get(name);
}

/** A Workers binding (an R2 bucket, say), which is an object rather than a string. */
export function readBinding(context: RuntimeContext, name: string): unknown {
  return runtimeEnv(context)?.[name];
}

/** How a platform-agnostic handler asks for a variable, without knowing about Astro. */
export type EnvReader = (name: string) => string | undefined;
export type BindingReader = (name: string) => unknown;

export const envReader =
  (context: RuntimeContext): EnvReader =>
  (name) =>
    readEnv(context, name);

export const bindingReader =
  (context: RuntimeContext): BindingReader =>
  (name) =>
    readBinding(context, name);
