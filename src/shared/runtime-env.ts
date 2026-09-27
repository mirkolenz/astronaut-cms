import { getSecret } from "astro:env/server";
import { env } from "virtual:astronaut-cms/runtime";

/**
 * Reads a runtime environment variable through `astro:env`, which every adapter
 * feeds from its own runtime and which validates the secrets the integration
 * declares. Shared by the injected server routes, which are the only code that
 * may see a secret and therefore the only code that reads the environment at all.
 */
export const readEnv: EnvReader = (name) => getSecret(name);

/** How a platform-agnostic handler asks for a variable, without knowing about Astro. */
export type EnvReader = (name: string) => string | undefined;
export type BindingReader = (name: string) => unknown;

/** A Workers binding (an R2 bucket, say), which is an object rather than a string. */
export const readBinding: BindingReader = (name) => env?.[name];
