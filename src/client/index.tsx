// Must stay the first import.
import "@/client/jitless";
import { createRoot } from "react-dom/client";
import { AdminApp } from "@/client/app";

// Follow the OS color scheme. Runs at module load (before render) so the dark
// class is set as early as possible; a CSS prefers-color-scheme fallback in
// styles.css covers the pre-hydration paint.
const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (dark: boolean) => document.documentElement.classList.toggle("dark", dark);
applyTheme(darkModeQuery.matches);
darkModeQuery.addEventListener("change", (e) => applyTheme(e.matches));

// Mounted from a bundled (external) module script rather than an Astro island, so
// the admin page ships no inline scripts and can run under a strict `script-src
// 'self'` CSP without hashes. See src/astro/admin.astro.
export function mount(element: HTMLElement): void {
  createRoot(element).render(<AdminApp />);
}
