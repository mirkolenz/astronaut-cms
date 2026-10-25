/** A value as text: a string as it is, anything else as indented JSON. */
export function formatJson(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
}
