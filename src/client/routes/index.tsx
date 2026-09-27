import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NotebookPen, BarChart3 } from "lucide-react";
import config from "@/client/lib/config";
import { toLabel } from "@/client/lib/to-label";
import { objectShape } from "@/shared/field-schema";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { collections } = config;

  if (Object.keys(collections).length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        <p className="text-lg">{t(($) => $.dashboard.noCollections)}</p>
        <p className="mt-1 text-sm">{t(($) => $.dashboard.defineCollections)}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <h1 className="mb-4 text-xl font-semibold">{t(($) => $.layout.collections)}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(collections).map(([name, col]) => (
          <Link
            key={name}
            to="/collections/$collection"
            params={{ collection: name }}
            className="group rounded-lg border border-border p-4 transition-colors hover:border-accent-foreground/30 hover:bg-accent"
          >
            <div className="flex items-center gap-2">
              {col.type === "content" ? (
                <NotebookPen className="size-5" />
              ) : (
                <BarChart3 className="size-5" />
              )}
              <h2 className="font-medium text-foreground group-hover:text-accent-foreground">
                {toLabel(name)}
              </h2>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {col.type === "content"
                ? t(($) => $.dashboard.contentCollection)
                : t(($) => $.dashboard.dataCollection)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {t(($) => $.dashboard.fields, {
                count: Object.keys(objectShape(col.schema) ?? {}).length,
              })}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
