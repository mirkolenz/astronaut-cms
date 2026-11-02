import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, File, Folder } from "lucide-react";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { basename } from "pathe";
import { entriesQuery, fileLayoutQuery, useEntries } from "@/client/queries/use-entries";
import { preload } from "@/client/lib/query-client";
import { NewEntryDialog } from "@/client/components/new-entry-dialog";
import { ErrorBanner } from "@/client/components/error-banner";
import { ListSkeleton } from "@/client/components/list-skeleton";
import { PageHeader } from "@/client/components/page-header";
import {
  collectionDescription,
  collectionLabel,
} from "@/client/lib/collections";
import { listDirectory } from "@/client/lib/entry-tree";
import { joinLocale, localeLabel, splitLocale } from "@/shared/i18n";
import { browseLocation, countIn, useCollectionI18n } from "@/client/lib/content-i18n";
import { LocaleTabs, TranslationStatus } from "@/client/components/locale-tabs";
import {
  compareIds,
  extractFormatsFromLoader,
  type EntryFormat,
  type EntryMeta,
} from "@/shared/types";
import { FileCollectionEditor } from "@/client/components/file-collection-editor";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import config from "@/client/lib/config";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/client/components/ui/item";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";

export const Route = createFileRoute("/collections/$collection/")({
  loader: ({ params: { collection } }) =>
    Promise.all([
      preload(entriesQuery(collection)),
      config.collections[collection]?.loaderType === "file" && preload(fileLayoutQuery(collection)),
    ]),
  pendingComponent: ListSkeleton,
  component: CollectionPage,
  validateSearch: (search: Record<string, unknown>): { dir?: string } => {
    const dir = typeof search.dir === "string" ? search.dir : "";
    return dir ? { dir } : {};
  },
});

/** Loads the entries once for every kind of collection, which each start fresh per collection. */
function CollectionPage() {
  const { t } = useTranslation();
  const { collection } = Route.useParams();
  const { data: entries, error } = useEntries(collection);
  // A localized singleton opens the default language.
  const singleton = config.collections[collection]?.singleton?.main;

  if (error) {
    return (
      <ErrorBanner>{t(($) => $.collection.failedLoad, { message: error.message })}</ErrorBanner>
    );
  }

  if (!entries) return <ListSkeleton />;

  // A singleton opens its one entry, as a draft until its file exists.
  if (singleton) {
    return (
      <Navigate
        to="/collections/$collection/$entry"
        params={{ collection, entry: singleton.id }}
        search={entries.some((entry) => entry.id === singleton.id) ? {} : { new: singleton.format }}
        replace
      />
    );
  }

  if (config.collections[collection]?.loaderType === "file") {
    return <FileCollectionEditor key={collection} collection={collection} entries={entries} />;
  }

  return <GlobCollectionPage key={collection} collection={collection} entries={entries} />;
}

function GlobCollectionPage({ collection, entries }: { collection: string; entries: EntryMeta[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { dir = "" } = Route.useSearch();
  const collectionInfo = config.collections[collection];
  const [showNewDialog, setShowNewDialog] = useState(false);
  const allowedFormats = useMemo(
    () =>
      extractFormatsFromLoader(
        collectionInfo?.loaderPattern ?? null,
        collectionInfo?.loaderFileName ?? null,
      ),
    [collectionInfo?.loaderPattern, collectionInfo?.loaderFileName],
  );
  const i18n = useCollectionI18n(entries);
  const locales = i18n?.locales ?? [];
  const { activeLocale, subDir, browseDir } = browseLocation(i18n, dir);

  const sort = collectionInfo?.sort ?? "id";
  const { folders, files } = useMemo(
    () => listDirectory(entries, browseDir, (entry) => entry.id, compareIds(sort)),
    [entries, browseDir, sort],
  );
  const isEmpty = folders.length === 0 && files.length === 0;

  // The header counts what the active language actually holds, so a half-translated
  // collection never reports one inflated total across all of them.
  const localeCount = i18n && activeLocale ? countIn(i18n, activeLocale) : entries.length;

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

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <PageHeader
        title={collectionLabel(collection)}
        description={`${collectionDescription(collection)} · ${t(($) => $.collection.entries, { count: localeCount })}`}
        actions={
          <>
            {activeLocale && (
              <LocaleTabs
                collection={collection}
                tabs={locales.map((locale) => ({ locale, dir: joinLocale(locale, subDir) }))}
                active={activeLocale}
              />
            )}
            <Button onClick={() => setShowNewDialog(true)}>
              {t(($) => $.collection.newEntry)}
            </Button>
          </>
        }
      />

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
        <ItemGroup>
          {folders.map((folder) => (
            <Item key={folder.path} asChild variant="outline" size="sm">
              <Link
                to="/collections/$collection"
                params={{ collection }}
                search={{ dir: folder.path }}
              >
                <ItemMedia variant="icon" className="text-muted-foreground">
                  <Folder />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{folder.name}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </ItemActions>
              </Link>
            </Item>
          ))}
          {files.map((entry) => (
            <Item key={entry.id} asChild variant="outline" size="sm">
              <Link to="/collections/$collection/$entry" params={{ collection, entry: entry.id }}>
                <ItemMedia variant="icon" className="text-muted-foreground">
                  <File />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {basename(entry.id)}
                    <Badge variant="outline">{entry.format}</Badge>
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  {i18n && (
                    <TranslationStatus i18n={i18n} slug={splitLocale(entry.id, locales).slug} />
                  )}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </ItemActions>
              </Link>
            </Item>
          ))}
        </ItemGroup>
      )}

      <NewEntryDialog
        open={showNewDialog}
        collection={collection}
        existingIds={entries.map((entry) => entry.id)}
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
