import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Library } from "lucide-react";
import config from "@/client/lib/config";
import { collectionDescription, collectionIcon, collectionLabel } from "@/client/lib/collections";
import { objectShape } from "@/shared/field-schema";
import { PageHeader } from "@/client/components/page-header";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/client/components/ui/item";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/client/components/ui/empty";

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
      <PageHeader title={t(($) => $.layout.collections)} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(collections).map(([name, col]) => {
          const Icon = collectionIcon(name);

          return (
            <Item key={name} asChild variant="outline">
              <Link to="/collections/$collection" params={{ collection: name }}>
                <ItemMedia variant="icon">
                  <Icon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{collectionLabel(name)}</ItemTitle>
                  <ItemDescription>{collectionDescription(name)}</ItemDescription>
                </ItemContent>
                <ItemFooter className="text-xs text-muted-foreground">
                  {t(($) => $.dashboard.fields, {
                    count: Object.keys(objectShape(col.schema) ?? {}).length,
                  })}
                </ItemFooter>
              </Link>
            </Item>
          );
        })}
      </div>
    </div>
  );
}
