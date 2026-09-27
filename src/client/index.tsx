import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@client/components/ui/tooltip";
import { queryClient } from "@client/lib/query-client";
import i18n from "@client/i18n";
import { router } from "./router";

// Follow the OS color scheme. Runs at module load (before render) so the dark
// class is set as early as possible; a CSS prefers-color-scheme fallback in
// styles.css covers the pre-hydration paint.
const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (dark: boolean) => document.documentElement.classList.toggle("dark", dark);
applyTheme(darkModeQuery.matches);
darkModeQuery.addEventListener("change", (e) => applyTheme(e.matches));

export default function AdminApp() {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

// Mounted from a bundled (external) module script rather than an Astro island, so
// the admin page ships no inline scripts and can run under a strict `script-src
// 'self'` CSP without hashes. See src/astro/admin.astro.
export function mount(element: HTMLElement): void {
  createRoot(element).render(<AdminApp />);
}
