import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Folder } from "lucide-react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEntries, useCreateEntry } from "@client/queries/use-entries";
import { useCollections } from "@client/queries/use-collections";
import { NewEntryDialog } from "@client/components/new-entry-dialog";
import { ErrorBanner } from "@client/components/error-banner";
import { toast } from "@client/components/toast";
import { toLabel } from "@client/lib/to-label";
import { baseName, listDirectory } from "@client/lib/entry-tree";
import { extractFormatsFromLoader } from "@shared/types";
import { FileCollectionEditor } from "@client/components/file-collection-editor";
import { Button } from "@client/components/ui/button";
import collectionMeta from "virtual:astronaut-cms/collections";

export const Route = createFileRoute("/collections/$collection/")({
  component: CollectionPage,
  validateSearch: (search: Record<string, unknown>): { dir?: string } => {
    const dir = typeof search.dir === "string" ? search.dir : "";
    return dir ? { dir } : {};
  },
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
  const { dir = "" } = Route.useSearch();
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
  const { folders, files } = useMemo(
    () => listDirectory(filteredEntries ?? [], dir),
    [filteredEntries, dir],
  );
  const isEmpty = folders.length === 0 && files.length === 0;

  const handleCreate = (id: string, format: string) => {
    createMutation.mutate(
      { id, format },
      {
        onSuccess: () => {
          setShowNewDialog(false);
          toast(t($ => $.collection.entryCreated), "success");
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
            className="h-12 animate-pulse rounded-lg border border-border bg-muted"
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
            <p className="mt-0.5 text-sm text-muted-foreground">
              {collectionInfo.type === "content" ? t($ => $.collection.contentCollection) : t($ => $.collection.dataCollection)} &middot;{" "}
              {t($ => $.collection.entries, { count: filteredEntries?.length ?? 0 })}
            </p>
          )}
        </div>
        <Button onClick={() => setShowNewDialog(true)}>
          {t($ => $.collection.newEntry)}
        </Button>
      </div>

      {isEmpty ? (
        <div className="text-center text-muted-foreground">
          <p>{t($ => $.collection.noEntries)}</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {folders.map((folder) => (
            <Link
              key={folder.path}
              to="/collections/$collection"
              params={{ collection }}
              search={{ dir: folder.path }}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted"
            >
              <div className="flex items-center gap-2">
                <Folder className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{folder.name}</span>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
          {files.map((entry) => (
            <Link
              key={entry.id}
              to="/collections/$collection/$entry"
              params={{ collection, entry: entry.id }}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted"
            >
              <div>
                <span className="text-sm font-medium text-foreground">
                  {baseName(entry.id)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">.{entry.format}</span>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}

      <NewEntryDialog
        open={showNewDialog}
        collection={collection}
        collectionType={collectionInfo?.type ?? "content"}
        basePath={dir}
        nested
        allowedFormats={allowedFormats}
        onSubmit={handleCreate}
        onCancel={() => setShowNewDialog(false)}
      />
    </div>
  );
}
