/**
 * The shape both injected routes answer in, and both of their browser clients
 * parse (`lib/ai/transport.ts`, `lib/media/remote.ts`).
 */
export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function jsonError(message: string, status: number): Response {
  return json({ error: { message } }, status);
}
