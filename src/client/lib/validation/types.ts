// A validation finding, plus the helpers that turn a batch of them into the ok /
// error envelope the AI tools return. Every finding blocks: a write that would
// leave content the site cannot build must not land, so there is no severity to
// distinguish and nothing that merely rides along with a successful write.

export interface Diagnostic {
  message: string;
  /** Dotted path to the offending value, e.g. "author" or "seo.image". */
  path?: string;
}

export const diagnostic = (message: string, path?: string): Diagnostic => ({ message, path });

export type ErrorResult = { error: string };

const line = (d: Diagnostic): string => (d.path ? `${d.path}: ${d.message}` : d.message);

function report(diagnostics: Diagnostic[]): string {
  return `Validation failed:\n${diagnostics.map((d) => `- ${line(d)}`).join("\n")}`;
}

/** Error envelope for a batch of findings, or null when there are none. */
export function toErrorResult(diagnostics: Diagnostic[]): ErrorResult | null {
  return diagnostics.length > 0 ? { error: report(diagnostics) } : null;
}

/**
 * Refusal of a write that would leave content the site cannot build. Distinct
 * from an ordinary failure so callers can tell "this content is wrong" (worth
 * reporting back for correction) from "the write did not go through".
 */
export class ContentValidationError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(report(diagnostics));
    this.name = "ContentValidationError";
    this.diagnostics = diagnostics;
  }
}
