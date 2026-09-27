/**
 * Astro-route shell over the platform-agnostic server in `handler.ts`: one
 * injected route covering every CMS API path, so the integration injects one
 * thing and the handler does the routing.
 */
import type { APIRoute } from "astro";
import { readBinding, readEnv } from "../shared/runtime-env.ts";
import { handle } from "./handler.ts";

export const prerender = false;

/** The whole API for one request, also what the dev server calls without a route around it. */
export const handleRequest = (request: Request): Promise<Response> =>
  handle(request, readEnv, readBinding);

const route: APIRoute = ({ request }) => handleRequest(request);

export const GET = route;
export const POST = route;
export const PUT = route;
