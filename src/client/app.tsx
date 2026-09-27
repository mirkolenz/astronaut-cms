import { I18nextProvider } from "react-i18next";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@client/components/ui/tooltip";
import { queryClient } from "@client/lib/query-client";
import { router } from "@client/router";
import i18n from "@client/i18n";

// Kept in its own module that exports nothing but components: React Fast Refresh
// bails out on any file mixing component and non-component exports, which is why
// `mount` and the theme setup live in index.tsx instead.
export function AdminApp() {
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
