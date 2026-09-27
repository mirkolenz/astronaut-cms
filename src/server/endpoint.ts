/**
 * Astro-route shell over the platform-agnostic server in `handler.ts`: one
 * injected route covering every CMS API path, so the integration injects one
 * thing and the handler does the routing.
 */
import type { APIRoute } from "astro";
import { bindingReader, envReader, type RuntimeContext } from "../shared/runtime-env.ts";
import { handle, readAdminState, type AdminState } from "./handler.ts";
import { signInPage } from "./sign-in-page.ts";

export const prerender = false;

const route: APIRoute = (context) =>
  handle(context.request, envReader(context), bindingReader(context));

export const GET = route;
export const POST = route;
export const PUT = route;

export { signInPage };
export type { AdminState };

/**
 * Whether the caller may see the admin, for `admin.astro` to ask before it
 * renders anything. Typed structurally because an Astro page is handed an
 * `AstroGlobal` rather than the `APIContext` a route gets, and only these three
 * members are ever read.
 */
export function adminState(
  context: RuntimeContext & { request: Request; url: URL },
): Promise<AdminState> {
  return readAdminState(context.request, context.url, envReader(context));
}
