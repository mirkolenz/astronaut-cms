import adapterEnv from "virtual:astronaut-cms/runtime-env";

/**
 * Reads a runtime environment variable across the runtimes the Astro adapters
 * target: Cloudflare Workers bindings and Node.
 * Shared by the injected server routes, which are the only code that may see a
 * secret and therefore the only code that reads the environment at all.
 */
export function readEnv(name: string): string | undefined {
  const value = adapterEnv?.[name];

  if (typeof value === "string") return value;

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

  return proc?.env?.[name];
}

/** How a platform-agnostic handler asks for a variable, without knowing about Astro. */
export type EnvReader = (name: string) => string | undefined;
export type BindingReader = (name: string) => unknown;

/** A Workers binding (an R2 bucket, say), which is an object rather than a string. */
export const readBinding: BindingReader = (name) => adapterEnv?.[name];
