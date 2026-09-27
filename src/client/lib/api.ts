/**
 * The CMS server, as the admin sees it: one typed call per operation and nothing
 * else. There is no provider SDK here, no token, and no way to name a repository
 * path — the browser can ask for exactly what the operation registry offers.
 *
 * The types come from the registry itself (`import type`, so none of the server
 * reaches this bundle), which is what keeps the two from drifting: adding an
 * operation makes it callable here, and changing its input breaks the call site.
 *
 * Calls made in the same tick travel together. Opening an entry asks for the
 * listing, the entry, the file layout and the state of the changeset, and those
 * are four queries React Query starts at once — as four requests they were four
 * function invocations, four cold starts and four repository trees. As one they
 * are one of each, because the server runs a batch against a single context.
 */
import type {
  OperationInput,
  OperationName,
  OperationOutput,
  OperationResult,
} from "@/server/operations";
import { API_LOGOUT, API_RPC, MAX_BATCH_OPS } from "@/shared/auth";
import { ContentValidationError, type Diagnostic } from "@/shared/diagnostics";
import { WRITE_HEADER } from "@/shared/http";
import { isWriteOperation } from "@/shared/operations";
import { invalidate, keysFor, type QueryKey } from "@/client/lib/query-keys";
import { apiFetch, apiUrl } from "@/client/lib/routes";

/** A refusal from the CMS server, keeping the status the UI reacts to. */
export class CmsError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CmsError";
    this.status = status;
  }
}

/** A publish or update the provider could not merge. */
export const isMergeConflict = (error: unknown): boolean =>
  error instanceof CmsError && error.status === 409;

/** A save refused because the entry moved since it was opened. Reloading resolves it. */
export const isStaleWrite = (error: unknown): boolean =>
  error instanceof CmsError && error.status === 412;

/** The session lapsed with the tab open, so the admin has to sign in again. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Your session has expired. Sign in again.");
    this.name = "UnauthenticatedError";
  }
}

/**
 * A lapsed session is the shell's to report: reloading re-runs the bootstrap,
 * which asks the server again and renders the sign-in link when the answer is
 * no. Guarded so a burst of failing requests reloads once rather than once each.
 */
let reloading = false;

function signInAgain(): void {
  if (reloading) return;

  reloading = true;
  window.location.reload();
}

interface ErrorBody {
  error?: { message?: string; validation?: Diagnostic[] };
}

/**
 * A refusal as the thing the caller catches. One place, so a refusal that ended
 * the whole request and one that ended a single operation inside a batch reach
 * the UI as the same error.
 */
function toError(status: number, message?: string, validation?: Diagnostic[]): Error {
  if (status === 401) {
    signInAgain();

    return new UnauthenticatedError();
  }

  // A refusal the content itself caused keeps its findings, so the editor and
  // the assistant both learn what to fix rather than that something failed.
  if (validation?.length) return new ContentValidationError(validation);

  return new CmsError(message ?? `Request failed (${status})`, status);
}

/**
 * The CMS's own response envelope, unwrapped. Used by the routes that answer one
 * thing — the media upload proxy — so a lapsed session and a refusal the content
 * caused read there exactly as they do for an operation.
 */
export async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;

  const { error } = (await response.json().catch(() => ({}))) as ErrorBody;

  throw toError(response.status, error?.message, error?.validation);
}

/** One call waiting for the batch it will travel in. */
interface Queued {
  op: OperationName;
  input: unknown;
  /** What the operation ages once it succeeded. */
  keys: QueryKey[];
  resolve: (data: unknown) => void;
  reject: (error: unknown) => void;
}

const queue: Queued[] = [];

/**
 * A macrotask rather than a microtask: React Query starts a mounted view's
 * queries across the render and the effects that follow it, and a microtask
 * would close the batch in between.
 */
function schedule(): void {
  if (queue.length === 1) setTimeout(flush);
}

function flush(): void {
  // Taken out of the queue rather than copied, so what did not fit is simply
  // what is left. That needs its own tick claimed, because `schedule` only ever
  // fires on an empty queue.
  const batch = queue.splice(0, MAX_BATCH_OPS);

  if (queue.length) setTimeout(flush);

  void send(batch);
}

async function send(batch: Queued[]): Promise<void> {
  try {
    const response = await apiFetch(apiUrl(API_RPC), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Only the caller knows whether this POST changes anything; `astro dev`
        // reads it to keep a save from reloading the page out from under you.
        ...(batch.some(({ op }) => isWriteOperation(op)) && { [WRITE_HEADER]: "1" }),
      },
      body: JSON.stringify(batch.map(({ op, input }) => ({ op, input }))),
    });

    // A failure of the request itself — a lapsed session, the whole batch
    // refused — belongs to every call in it.
    if (!response.ok) {
      const { error } = (await response.json().catch(() => ({}))) as ErrorBody;

      throw toError(response.status, error?.message, error?.validation);
    }

    const results = (await response.json()) as OperationResult[];
    // Collected across the batch rather than applied per call, so twenty writes
    // to one collection age its keys once. Here rather than at the call sites,
    // so a write ages what it changed whoever made it: a mutation hook, the
    // assistant, or an agent reaching the same tools over WebMCP.
    const aged: (readonly unknown[])[] = [];

    batch.forEach((call, index) => {
      const result = results[index];

      if (!result) {
        call.reject(new CmsError("The server answered with fewer results than operations.", 500));
      } else if (result.ok) {
        call.resolve(result.data);
        aged.push(...call.keys);
      } else {
        call.reject(toError(result.error.status, result.error.message, result.error.validation));
      }
    });

    invalidate(aged);
  } catch (err) {
    for (const call of batch) call.reject(err);
  }
}

/** Runs one operation on the server, in the next batch to leave. */
export async function call<K extends OperationName>(
  op: K,
  input: OperationInput<K>,
): Promise<OperationOutput<K>> {
  return new Promise<OperationOutput<K>>((resolve, reject) => {
    queue.push({
      op,
      input,
      keys: keysFor(op, input),
      resolve: resolve as (data: unknown) => void,
      reject,
    });

    schedule();
  });
}

export async function signOut(): Promise<void> {
  await apiFetch(apiUrl(API_LOGOUT), { method: "POST" });
}
