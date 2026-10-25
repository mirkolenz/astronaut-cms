import { QueryClient, type EnsureQueryDataOptions, type QueryKey } from "@tanstack/react-query";

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

/**
 * Holds a navigation until a query is cached, so the page paints with its
 * data instead of flashing a placeholder for the few milliseconds a fetch takes.
 * A failed query is left in the cache for the page to report, as before.
 */
export async function preload<T, K extends QueryKey>(
  query: EnsureQueryDataOptions<T, Error, T, K>,
): Promise<void> {
  await queryClient.ensureQueryData(query).catch(() => undefined);
}
