import { I18nextProvider } from "react-i18next";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@client/components/ui/tooltip";
import { queryClient } from "@client/lib/query-client";
import { useWebmcpTools } from "@client/lib/webmcp";
import { router } from "@client/router";
import i18n from "@client/i18n";

// Kept in its own module that exports nothing but components: React Fast Refresh
// bails out on any file mixing component and non-component exports, which is why
// `mount` and the theme setup live in index.tsx instead.
export function AdminApp() {
  // Here rather than in a route: the tools are the CMS's, not a page's, so they
  // stay registered across navigation and are withdrawn when the admin goes
  // away. Nothing below it is needed — the hook reaches the module-level query
  // client and RPC client directly — so the tree stays providers only.
  useWebmcpTools();

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
