/**
 * Astro-route shell over the platform-agnostic server in `handler.ts`: one
 * injected route covering every CMS API path, so the integration injects one
 * thing and the handler does the routing.
 */
import type { APIRoute } from "astro";
import { readBinding, readEnv } from "../shared/runtime-env.ts";
import { handle } from "./handler.ts";

export const prerender = false;

const route: APIRoute = ({ request }) => handle(request, readEnv, readBinding);

export const GET = route;
export const POST = route;
export const PUT = route;
