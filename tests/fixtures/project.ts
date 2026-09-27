import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "pathe";
import { onTestFinished } from "vitest";

/** A throwaway project directory holding `files`, removed once the test finishes. */
export function project(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "astronaut-project-")));

  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  return root;
}
