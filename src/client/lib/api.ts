// Served at the origin root, not under `base`: the dev server listens there
// whatever `base` is, and a `/_`-prefixed path is one Astro treats as internal
// and passes through its own middlewares untouched.
const API_BASE = "/__cms";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
