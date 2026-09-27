import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NotebookPen, BarChart3, Library } from "lucide-react";
import config from "@/client/lib/config";
import { toLabel } from "@/client/lib/to-label";
import { objectShape } from "@/shared/field-schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { collections } = config;

  if (Object.keys(collections).length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Library />
          </EmptyMedia>
          <EmptyTitle>{t(($) => $.dashboard.noCollections)}</EmptyTitle>
          <EmptyDescription>{t(($) => $.dashboard.defineCollections)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <h1 className="mb-4 text-xl font-semibold">{t(($) => $.layout.collections)}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(collections).map(([name, col]) => (
          <Link key={name} to="/collections/$collection" params={{ collection: name }} className="group">
            <Card className="h-full transition-colors group-hover:bg-accent">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {col.type === "content" ? (
                    <NotebookPen className="size-5" />
                  ) : (
                    <BarChart3 className="size-5" />
                  )}
                  {toLabel(name)}
                </CardTitle>
                <CardDescription>
                  {col.type === "content"
                    ? t(($) => $.dashboard.contentCollection)
                    : t(($) => $.dashboard.dataCollection)}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground/70">
                {t(($) => $.dashboard.fields, {
                  count: Object.keys(objectShape(col.schema) ?? {}).length,
                })}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
