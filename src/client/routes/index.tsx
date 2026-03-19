import { Link, createFileRoute } from "@tanstack/react-router";
import { useCollections } from "@/client/queries/use-collections";
import { ErrorBanner } from "@/client/components/error-banner";
import { toLabel } from "@/client/lib/to-label";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const { data: collections, isLoading, error } = useCollections();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>Failed to load collections: {error.message}</ErrorBanner>;
  }

  if (!collections || Object.keys(collections).length === 0) {
    return (
      <div className="text-center text-gray-500">
        <p className="text-lg">No collections found</p>
        <p className="mt-1 text-sm">Define collections in your content.config.ts</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <h1 className="mb-4 text-xl font-semibold">Collections</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(collections).map(([name, col]) => (
          <Link
            key={name}
            to="/collections/$collection"
            params={{ collection: name }}
            className="group rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-700 dark:hover:bg-blue-950"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{col.type === "content" ? "\u{1F4DD}" : "\u{1F4CA}"}</span>
              <h2 className="font-medium text-gray-900 group-hover:text-blue-700 dark:text-gray-100 dark:group-hover:text-blue-300">
                {toLabel(name)}
              </h2>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {col.type === "content" ? "Content" : "Data"} collection
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {Object.keys(col.schema.shape ?? {}).length} fields
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
