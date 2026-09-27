import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, File, Folder } from "lucide-react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEntries } from "@/client/queries/use-entries";
import { NewEntryDialog } from "@/client/components/new-entry-dialog";
import { ErrorBanner } from "@/client/components/error-banner";
import { toLabel } from "@/client/lib/to-label";
import { baseName, listDirectory } from "@/client/lib/entry-tree";
import { localeLabel, splitLocale } from "@/shared/i18n";
import { browseLocation, countIn, useCollectionI18n } from "@/client/lib/content-i18n";
import { LocaleTabs } from "@/client/components/locale-tabs";
import { TranslationStatus } from "@/client/components/translation-status";
import {
  compareIds,
  extractFormatsFromLoader,
  type CollectionManifestEntry,
  type EntryFormat,
} from "@/shared/types";
import { FileCollectionEditor } from "@/client/components/file-collection-editor";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import config from "@/client/lib/config";
import { Card } from "@/client/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";
import { Skeleton } from "@/client/components/ui/skeleton";

export const Route = createFileRoute("/collections/$collection/")({
  component: CollectionPage,
  validateSearch: (search: Record<string, unknown>): { dir?: string } => {
    const dir = typeof search.dir === "string" ? search.dir : "";
    return dir ? { dir } : {};
  },
});

function CollectionPage() {
  const { collection } = Route.useParams();
  const collectionInfo = config.collections[collection];

  if (collectionInfo?.loaderType === "file") {
    return <FileCollectionEditor collection={collection} />;
  }

  return <GlobCollectionPage collection={collection} collectionInfo={collectionInfo} />;
}

function GlobCollectionPage({
  collection,
  collectionInfo,
}: {
  collection: string;
  collectionInfo?: CollectionManifestEntry;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { dir = "" } = Route.useSearch();
  const { data: entries, isLoading, error } = useEntries(collection);
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
  const i18n = useCollectionI18n(filteredEntries);
  const locales = i18n?.locales ?? [];
  const { activeLocale, subDir, browseDir } = browseLocation(i18n, dir);

  const sort = collectionInfo?.sort ?? "id";
  const { folders, files } = useMemo(
    () => listDirectory(filteredEntries ?? [], browseDir, (entry) => entry.id, compareIds(sort)),
    [filteredEntries, browseDir, sort],
  );
  const isEmpty = folders.length === 0 && files.length === 0;

  // The header counts what the active language actually holds, so a half-translated
  // collection never reports one inflated total across all of them.
  const localeCount =
    i18n && activeLocale ? countIn(i18n, activeLocale) : (filteredEntries?.length ?? 0);

  // Nothing is written yet: the editor holds the new entry until its first save,
  // so an abandoned one leaves no invalid file behind.
  const handleCreate = (id: string, format: EntryFormat) => {
    setShowNewDialog(false);
    void navigate({
      to: "/collections/$collection/$entry",
      params: { collection, entry: id },
      search: { new: format },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorBanner>{t(($) => $.collection.failedLoad, { message: error.message })}</ErrorBanner>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{toLabel(collection)}</h1>
          {collectionInfo && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {collectionInfo.type === "content"
                ? t(($) => $.collection.contentCollection)
                : t(($) => $.collection.dataCollection)}{" "}
              &middot; {t(($) => $.collection.entries, { count: localeCount })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeLocale && (
            <LocaleTabs
              collection={collection}
              locales={locales}
              active={activeLocale}
              subDir={subDir}
            />
          )}
          <Button onClick={() => setShowNewDialog(true)}>{t(($) => $.collection.newEntry)}</Button>
        </div>
      </div>

      {isEmpty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <File />
            </EmptyMedia>
            <EmptyTitle>
              {activeLocale
                ? t(($) => $.i18n.noEntriesInLanguage, { language: localeLabel(activeLocale) })
                : t(($) => $.collection.noEntries)}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="gap-0 divide-y py-0">
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
              <div className="flex items-center gap-2">
                <File className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{baseName(entry.id)}</span>
                <Badge variant="outline">{entry.format}</Badge>
              </div>
              <div className="flex items-center gap-2">
                {i18n && (
                  <TranslationStatus i18n={i18n} slug={splitLocale(entry.id, locales).slug} />
                )}
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </Card>
      )}

      <NewEntryDialog
        open={showNewDialog}
        collection={collection}
        collectionType={collectionInfo?.type ?? "content"}
        basePath={subDir}
        locales={i18n?.locales}
        locale={activeLocale}
        nested
        allowedFormats={allowedFormats}
        onSubmit={handleCreate}
        onCancel={() => setShowNewDialog(false)}
      />
    </div>
  );
}
