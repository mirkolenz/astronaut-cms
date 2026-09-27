// Severity-tagged validation finding plus the helpers that turn a batch of them
// into the ok / warning / error envelope the AI tools return. Errors block the
// write. Warnings let it through but ride along so the model can react.

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** Dotted path to the offending value, e.g. "author" or "seo.image". */
  path?: string;
}

export const error = (message: string, path?: string): Diagnostic => ({
  severity: "error",
  message,
  path,
});

export const warning = (message: string, path?: string): Diagnostic => ({
  severity: "warning",
  message,
  path,
});

export type OkResult = { ok: true } | { ok: true; warnings: string[] };
export type ErrorResult = { error: string };

const line = (d: Diagnostic): string => (d.path ? `${d.path}: ${d.message}` : d.message);

function format(title: string, diagnostics: Diagnostic[]): string {
  return `${title}:\n${diagnostics.map((d) => `- ${line(d)}`).join("\n")}`;
}

/** Error envelope for a pure pre-check, or null when there are no errors. */
export function toErrorResult(diagnostics: Diagnostic[]): ErrorResult | null {
  const errors = diagnostics.filter((d) => d.severity === "error");

  return errors.length ? { error: format("Validation failed", errors) } : null;
}

/**
 * Commits a write only when no error-level diagnostics are present. Warnings do
 * not block: the write lands and the warnings ride along so the model can react.
 */
export async function commitWithDiagnostics(
  diagnostics: Diagnostic[],
  commit: () => Promise<void>,
): Promise<OkResult | ErrorResult> {
  const blocking = toErrorResult(diagnostics);

  if (blocking) return blocking;

  await commit();

  const warnings = diagnostics.filter((d) => d.severity === "warning");

  return warnings.length ? { ok: true, warnings: warnings.map(line) } : { ok: true };
}
