import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEntries, useCreateEntry } from "@/client/queries/use-entries";
import { useCollections } from "@/client/queries/use-collections";
import { NewEntryDialog } from "@/client/components/new-entry-dialog";
import { ErrorBanner } from "@/client/components/error-banner";
import { toast } from "@/client/components/toast";
import { toLabel } from "@/client/lib/to-label";
import { extractFormatsFromLoader } from "@/shared/types";
import { FileCollectionEditor } from "@/client/components/file-collection-editor";
import { Button } from "@/client/components/ui/button";
import collectionMeta from "virtual:astronaut-cms/collections";

export const Route = createFileRoute("/collections/$collection/")({
  component: CollectionPage,
});

function CollectionPage() {
  const { collection } = Route.useParams();
  const { data: collections } = useCollections();
  const collectionInfo = collections?.[collection];
  const meta = collectionMeta[collection];

  if (meta?.loaderType === "file") {
    return <FileCollectionEditor collection={collection} />;
  }

  return <GlobCollectionPage collection={collection} collectionInfo={collectionInfo} />;
}

function GlobCollectionPage({
  collection,
  collectionInfo,
}: {
  collection: string;
  collectionInfo?: (typeof collectionMeta)[string];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: entries, isLoading, error } = useEntries(collection);
  const createMutation = useCreateEntry(collection);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const allowedFormats = useMemo(
    () =>
      extractFormatsFromLoader(
        collectionInfo?.loaderPattern ?? null,
        collectionInfo?.loaderFileName ?? null,
      ),
    [collectionInfo?.loaderPattern, collectionInfo?.loaderFileName],
  );
  const filteredEntries = useMemo(() => {
    if (!entries || !allowedFormats) return entries;
    return entries.filter((e) => allowedFormats.includes(e.format));
  }, [entries, allowedFormats]);

  const handleCreate = (id: string, format: string) => {
    createMutation.mutate(
      { id, format },
      {
        onSuccess: () => {
          setShowNewDialog(false);
          toast(t($ => $.collection.createStaged), "success");
          void navigate({
            to: "/collections/$collection/$entry",
            params: { collection, entry: id },
          });
        },
        onError: (err) => {
          toast(err.message, "error");
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>{t($ => $.collection.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{toLabel(collection)}</h1>
          {collectionInfo && (
            <p className="mt-0.5 text-sm text-gray-500">
              {collectionInfo.type === "content" ? t($ => $.collection.contentCollection) : t($ => $.collection.dataCollection)} &middot;{" "}
              {t($ => $.collection.entries, { count: filteredEntries?.length ?? 0 })}
            </p>
          )}
        </div>
        <Button onClick={() => setShowNewDialog(true)}>
          {t($ => $.collection.newEntry)}
        </Button>
      </div>

      {(!filteredEntries || filteredEntries.length === 0) && (
        <div className="text-center text-gray-500">
          <p>{t($ => $.collection.noEntries)}</p>
        </div>
      )}

      {filteredEntries && filteredEntries.length > 0 && (
        <div className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {filteredEntries.map((entry) => (
            <Link
              key={entry.id}
              to="/collections/$collection/$entry"
              params={{ collection, entry: entry.id }}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {entry.id}
                </span>
                <span className="ml-2 text-xs text-gray-400">.{entry.format}</span>
              </div>
              <ChevronRight className="size-4 text-gray-400" />
            </Link>
          ))}
        </div>
      )}

      <NewEntryDialog
        open={showNewDialog}
        collection={collection}
        collectionType={collectionInfo?.type ?? "content"}
        allowedFormats={allowedFormats}
        onSubmit={handleCreate}
        onCancel={() => setShowNewDialog(false)}
      />
    </div>
  );
}
