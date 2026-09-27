/** Compile-time exhaustiveness for a closed union, and a fail-closed throw if one grows. */
export function unreachable(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
