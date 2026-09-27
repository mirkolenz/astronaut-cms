/**
 * The CMS server, as the admin sees it: one typed call per operation and nothing
 * else. There is no provider SDK here, no token, and no way to name a repository
 * path — the browser can ask for exactly what the operation registry offers.
 *
 * The types come from the registry itself (`import type`, so none of the server
 * reaches this bundle), which is what keeps the two from drifting: adding an
 * operation makes it callable here, and changing its input breaks the call site.
 */
import type {
  OperationInput,
  OperationName,
  OperationOutput,
} from "@server/operations";
import { API_LOGOUT, API_RPC } from "@shared/auth";
import { ContentValidationError, type Diagnostic } from "@shared/diagnostics";
import { WRITE_HEADER } from "@shared/http";
import { isWriteOperation } from "@shared/operations";
import { apiFetch, apiUrl } from "@client/lib/routes";

/** A refusal from the CMS server, keeping the status the UI reacts to. */
export class CmsError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CmsError";
    this.status = status;
  }
}

/** A publish or update the provider could not merge, which is the one status the UI branches on. */
export const isMergeConflict = (error: unknown): boolean =>
  error instanceof CmsError && error.status === 409;

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
 * The CMS's own response envelope, unwrapped. Every call goes through it so a
 * lapsed session reloads once and a refusal the content caused keeps its
 * findings, whichever route answered.
 */
export async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;

  if (response.status === 401) {
    signInAgain();

    throw new UnauthenticatedError();
  }

  const { error } = (await response.json().catch(() => ({}))) as ErrorBody;

  // A refusal the content itself caused keeps its findings, so the editor and
  // the assistant both learn what to fix rather than that something failed.
  if (error?.validation?.length) throw new ContentValidationError(error.validation);

  throw new CmsError(error?.message ?? `Request failed (${response.status})`, response.status);
}

/** Runs one operation on the server. */
export async function call<K extends OperationName>(
  op: K,
  input: OperationInput<K>,
): Promise<OperationOutput<K>> {
  return unwrap<OperationOutput<K>>(
    await apiFetch(apiUrl(API_RPC), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Only the caller knows whether this POST changes anything; `astro dev`
        // reads it to keep a save from reloading the page out from under you.
        ...(isWriteOperation(op) && { [WRITE_HEADER]: "1" }),
      },
      body: JSON.stringify({ op, input }),
    }),
  );
}

export async function signOut(): Promise<void> {
  await apiFetch(apiUrl(API_LOGOUT), { method: "POST" });
}

