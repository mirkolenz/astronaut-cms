/** An error with the HTTP status it should reach the browser as. */
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Runs a check that throws a plain Error, and gives its failure an HTTP meaning. */
export function checked<T>(status: number, run: () => T): T {
  try {
    return run();
  } catch (err) {
    throw new HttpError(err instanceof Error ? err.message : "Invalid request.", status);
  }
}
