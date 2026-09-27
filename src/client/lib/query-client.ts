import { QueryClient } from "@tanstack/react-query";

// Module-level rather than created in the provider so non-React callers (the AI
// agent, which writes through the storage layer instead of the mutation hooks)
// can invalidate the same cache.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
