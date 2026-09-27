import { QueryClient } from "@tanstack/react-query";

// Module-level rather than created in the provider because `lib/api.ts` ages the
// cache itself after every write, and it is reached from far outside React: the
// assistant's tool loop, an agent calling in over WebMCP, a media upload.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
