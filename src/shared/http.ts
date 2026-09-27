/**
 * What every CMS-owned response and every CMS-owned request body has in common,
 * so no injected route has to restate it.
 */

/**
 * Hardening headers carried by every response the CMS serves. `nosniff` keeps a
 * body from being interpreted as something other than the type it declares, and
 * `no-referrer` keeps repository, entry and media paths out of the `Referer` of
 * everything the admin reaches.
 */
export const HARDENING_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** Thrown by {@link readBody} when a request body exceeds a route's limit. */
export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body is larger than the ${maxBytes} byte limit for this endpoint.`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * The request body as text, refusing anything over `maxBytes`. A route that
 * forwards a body to a paid upstream, or spends a secret on it, cannot let the
 * caller choose its size — and `content-length` is only a claim, so the stream
 * is measured as it is read rather than trusted up front.
 */
export async function readBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);

  const reader = request.body?.getReader();

  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    size += value.length;

    if (size > maxBytes) {
      await reader.cancel();

      throw new BodyTooLargeError(maxBytes);
    }

    // Streaming, so a multi-byte character split across two chunks survives.
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}
