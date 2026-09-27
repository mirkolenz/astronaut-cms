/**
 * A REST client for one Git provider, over `fetch` and nothing else.
 *
 * The provider SDKs were 1.1 MB of runtime JavaScript for the twenty-nine
 * endpoints the CMS actually calls, and `@gitbeaker` in particular drags in a
 * Node-only rate limiter and a query-string library that have no business in a
 * Workers bundle. This is the whole of what they were used for.
 *
 * Errors carry the HTTP status, which is the only thing any caller reads off
 * them (see `getErrorStatus`).
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiRequest {
  /** Appended to the base URL. Interpolate and encode path segments before passing them. */
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Overrides the client's default, e.g. to select a provider media type. */
  accept?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(baseUrl: string, headers: Record<string, string>) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.headers = headers;
  }

  async send({ path, method = "GET", query, body, accept }: ApiRequest): Promise<Response> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method,
      headers: {
        ...this.headers,
        ...(accept && { accept }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!response.ok) throw new ApiError(response.status, await describe(response));

    return response;
  }

  async json<T>(request: ApiRequest): Promise<T> {
    return (await this.send(request)).json() as Promise<T>;
  }

  async text(request: ApiRequest): Promise<string> {
    return (await this.send(request)).text();
  }

  async bytes(request: ApiRequest): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await (await this.send(request)).arrayBuffer());
  }

  /** A call made for its effect, whose body is of no interest. */
  async run(request: ApiRequest): Promise<void> {
    await this.send(request);
  }
}

/** Both providers answer a failure with `{ message }`; the status is the fallback. */
async function describe(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;

  return body?.message ?? body?.error ?? `${response.status} ${response.statusText}`;
}
