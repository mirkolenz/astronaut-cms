import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NotebookPen, BarChart3 } from "lucide-react";
import { useCollections } from "@client/queries/use-collections";
import { ErrorBanner } from "@client/components/error-banner";
import { toLabel } from "@client/lib/to-label";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { data: collections, isLoading, error } = useCollections();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>{t($ => $.dashboard.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  if (!collections || Object.keys(collections).length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        <p className="text-lg">{t($ => $.dashboard.noCollections)}</p>
        <p className="mt-1 text-sm">{t($ => $.dashboard.defineCollections)}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <h1 className="mb-4 text-xl font-semibold">{t($ => $.layout.collections)}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(collections).map(([name, col]) => (
          <Link
            key={name}
            to="/collections/$collection"
            params={{ collection: name }}
            className="group rounded-lg border border-border p-4 transition-colors hover:border-accent-foreground/30 hover:bg-accent"
          >
            <div className="flex items-center gap-2">
              {col.type === "content" ? <NotebookPen className="size-5" /> : <BarChart3 className="size-5" />}
              <h2 className="font-medium text-foreground group-hover:text-accent-foreground">
                {toLabel(name)}
              </h2>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {col.type === "content" ? t($ => $.dashboard.contentCollection) : t($ => $.dashboard.dataCollection)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {t($ => $.dashboard.fields, { count: Object.keys(col.schema.shape ?? {}).length })}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
