/**
 * Astro-route shell over the server in `handler.ts`: one
 * injected route covering every CMS API path, so the integration injects one
 * thing and the handler does the routing.
 */
import type { APIRoute } from "astro";
import { handle } from "./handler.ts";

export const prerender = false;

/** The whole API for one request, also what the dev server calls without a route around it. */
export { handle };

const route: APIRoute = ({ request }) => handle(request);

export const GET = route;
export const POST = route;
export const PUT = route;
