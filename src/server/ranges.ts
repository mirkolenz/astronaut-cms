/**
 * Reading a range of a file from an upstream source, shared by every backend
 * that streams its bytes through the media route (GitLab's raw endpoint) and by
 * the route itself when it proxies a download URL (GitHub). One policy for
 * forwarding the range, refusing a failed answer and relaying what came back,
 * so the forges cannot drift apart.
 */
import { HttpError } from "./errors.ts";
import { partialContent, rangeHeader, type ByteRange, type PartialContent } from "../shared/http.ts";

/** Upstream bytes as the media route relays them, whole or as one range. */
export interface RelayedBytes {
  body: ReadableStream<Uint8Array> | null;
  partial?: PartialContent;
}

/**
 * Sends a request with `range` forwarded and relays the answer, along with the
 * answer's headers for whatever else the caller reads off them. `send` makes
 * the request with the headers it is handed, and may add its own credentials.
 */
export async function fetchRange(
  send: (headers: Record<string, string>) => Promise<Response>,
  range: ByteRange | null | undefined,
): Promise<RelayedBytes & { headers: Headers }> {
  const response = await send(range ? { range: rangeHeader(range) } : {});

  if (response.status !== 416 && (!response.ok || !response.body)) {
    throw new HttpError(`Could not read the media file (${response.status}).`, 502);
  }

  if (response.status === 206 && !response.headers.has("content-range")) {
    await response.body?.cancel();

    throw new HttpError("The media source returned partial bytes without a content range.", 502);
  }

  return { ...relayRange(response, range ?? null), headers: response.headers };
}

/** The bytes `start` through `end` (inclusive) of a stream, cancelling the rest unread. */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  { start, end }: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let position = 0;

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) return controller.close();

      const from = Math.max(start - position, 0);
      const to = Math.min(end + 1 - position, value.length);

      position += value.length;

      if (from < to) controller.enqueue(value.subarray(from, to));

      if (position > end) {
        controller.close();
        await reader.cancel();
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

/**
 * An upstream answer to a request that forwarded `range`, as the media route
 * relays it. A source that honoured the range is passed through. One that sent
 * the whole file is cut here while streaming, so memory stays at one chunk
 * whether or not the source supports ranges.
 */
function relayRange(
  response: Response,
  range: ByteRange | null,
): RelayedBytes {
  const { body, status } = response;
  const contentRange = response.headers.get("content-range");

  if (status === 416) {
    void body?.cancel();

    return { body: null, partial: { status, contentRange: contentRange ?? undefined } };
  }

  if (status === 206 && contentRange) return { body, partial: { status, contentRange } };

  const size = Number(response.headers.get("content-length") ?? Number.NaN);

  if (!range || !body || status !== 200 || !Number.isSafeInteger(size)) return { body };

  const partial = partialContent(range, size);

  if (!partial.span) {
    void body.cancel();

    return { body: null, partial };
  }

  return { body: sliceStream(body, partial.span), partial };
}
