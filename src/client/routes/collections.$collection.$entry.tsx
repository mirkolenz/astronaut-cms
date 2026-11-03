import { useState, useCallback, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { basename } from "pathe";
import {
  entriesQuery,
  entryQuery,
  useEntries,
  useEntry,
  useSaveEntry,
  useDeleteEntry,
  useRenameEntry,
  useDuplicateEntry,
} from "@/client/queries/use-entries";
import { EntryFields } from "@/client/components/editors/field-inspector";
import { objectShape } from "@/shared/field-schema";
import { schemaDefaults } from "@/shared/collection-schema";
import { MdxEditor, type MdxEditorHandle } from "@/client/components/editors/mdx-editor";
import { InspectorPanel } from "@/client/components/editors/component-inspector";
import { HistoryControls } from "@/client/components/editors/history-controls";
import {
  clearHistory,
  getForm,
  markSaved,
  openForm,
  resetForms,
  useFormDirty,
} from "@/client/stores/form-store";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import {
  UnsavedChangesDialog,
  useUnsavedChangesBlocker,
} from "@/client/components/unsaved-changes-dialog";
import { EntryIdDialog } from "@/client/components/entry-id-dialog";
import { ErrorBanner } from "@/client/components/error-banner";
import { PageHeader } from "@/client/components/page-header";
import { SaveActions } from "@/client/components/save-actions";
import { LocaleTabs } from "@/client/components/locale-tabs";
import { DATA_FORMATS, entryFilePath } from "@/shared/types";
import { EntryContextProvider } from "@/client/lib/entry-context";
import { splitLocale, translationsOf } from "@/shared/i18n";
import { useCollectionI18n } from "@/client/lib/content-i18n";
import { useRunMutation } from "@/client/hooks/use-run-mutation";
import { Button } from "@/client/components/ui/button";
import config from "@/client/lib/config";
import { preload } from "@/client/lib/query-client";
import { collectionDescription, collectionLabel, isSingleton } from "@/client/lib/collections";
import { asEntryFormat, type EntryFormat } from "@/shared/types";
import { Skeleton } from "@/client/components/ui/skeleton";

export const Route = createFileRoute("/collections/$collection/$entry")({
  component: EntryRoute,
  // `new` carries the format of an entry that does not exist yet: the editor
  // holds it as a draft and the first save creates it.
  validateSearch: (search: Record<string, unknown>): { new?: EntryFormat } => {
    const format = typeof search.new === "string" ? asEntryFormat(search.new) : null;

    return format ? { new: format } : {};
  },
  loaderDeps: ({ search }) => ({ isNew: search.new !== undefined }),
  loader: ({ params: { collection, entry }, deps: { isNew } }) =>
    Promise.all([
      preload(entriesQuery(collection)),
      !isNew && preload(entryQuery(collection, entry)),
    ]),
  pendingComponent: EntrySkeleton,
});

function EntrySkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

/** Keyed by the entry, so its editor starts from that entry's content in the first frame. */
function EntryRoute() {
  const { collection, entry } = Route.useParams();

  return <EntryEditor key={`${collection}/${entry}`} />;
}

function EntryEditor() {
  const { t } = useTranslation();
  const { collection, entry: entryId } = Route.useParams();
  const { new: newFormat } = Route.useSearch();
  const isNew = newFormat !== undefined;
  const navigate = useNavigate();
  const run = useRunMutation();
  const { data: entry, error } = useEntry(collection, entryId, { enabled: !isNew });
  const { data: entries } = useEntries(collection);
  const saveMutation = useSaveEntry(collection, entryId);
  const deleteMutation = useDeleteEntry(collection);
  const renameMutation = useRenameEntry(collection);
  const duplicateMutation = useDuplicateEntry(collection);

  const meta = config.collections[collection];
  const singleton = isSingleton(collection);
  const shape = objectShape(meta?.schema);
  const format = entry?.format ?? newFormat;
  const form = `${collection}/${entryId}`;
  const label = basename(entryId);
  const [editBody, setEditBody] = useState(entry?.body ?? "");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);

  const entryIds = (entries ?? []).map((e) => e.id);
  const i18n = useCollectionI18n(entries);
  const { locale: entryLocale, slug } = splitLocale(entryId, i18n?.locales ?? []);

  const [bodyDirty, setBodyDirty] = useState(false);
  const formDirty = useFormDirty(form);
  // A draft has nothing saved yet, so it starts dirty: Save is what creates it.
  const isDirty = isNew || formDirty || bodyDirty;
  const baselineVersion = useRef<string | undefined>(undefined);

  // Layout effects, so the fields are filled before the first paint. The reset
  // must be one too, or the closing editor's would run after the next one opened.
  useLayoutEffect(() => () => resetForms(), [form]);

  useLayoutEffect(() => {
    if (isNew)
      openForm(form, { values: schemaDefaults(shape), saved: null, shape: shape ?? {}, label });
  }, [form, isNew, shape, label]);

  useLayoutEffect(() => {
    if (entry && !isDirty) {
      openForm(form, { values: entry.data, saved: entry.data, shape: shape ?? {}, label });
      setEditBody(entry.body);
      baselineVersion.current = entry.version;
    }
  }, [entry, isDirty, form, shape, label]);

  // Leaving the page drops the history, so unsaved changes are confirmed first.
  const blocker = useUnsavedChangesBlocker(isDirty);

  const bodyRef = useRef<MdxEditorHandle>(null);

  const handleSave = () => {
    // Read from the editor, which holds an edit inside a component before `editBody` does.
    const body = bodyRef.current?.flush() ?? editBody;
    const data = getForm(form)?.values ?? {};

    if (!format) return;

    run(
      saveMutation,
      // The version this edit was made against, so a save cannot silently
      // discard one that landed while the editor was open. A new entry has none:
      // there is nothing yet for it to have been based on.
      { data, body, format, createOnly: isNew, expectedVersion: baselineVersion.current },
      {
        success: isNew ? t(($) => $.collection.entryCreated) : t(($) => $.entry.changesSaved),
        onSuccess: ({ version }) => {
          baselineVersion.current = version;
          markSaved(form, data);
          setBodyDirty(false);

          // The draft is now a stored entry: drop the flag so the editor loads it.
          if (isNew) {
            void navigate({
              to: "/collections/$collection/$entry",
              params: { collection, entry: entryId },
              search: {},
              replace: true,
              ignoreBlocker: true,
            });
          }
        },
      },
    );
  };

  const [editorKey, setEditorKey] = useState(0);

  const handleCancel = () => {
    if (isNew) {
      void navigate({
        to: "/collections/$collection",
        params: { collection },
        replace: true,
        ignoreBlocker: true,
      });

      return;
    }

    if (!entry) return;

    openForm(form, { values: entry.data, saved: entry.data, shape: shape ?? {}, label });
    clearHistory();
    setEditBody(entry.body);
    baselineVersion.current = entry.version;
    setBodyDirty(false);
    setEditorKey((k) => k + 1);
  };

  const handleDelete = () => {
    run(
      deleteMutation,
      { id: entryId, expectedVersion: baselineVersion.current },
      {
        success: t(($) => $.collection.entryDeleted),
        onSuccess: () => {
          setShowDeleteConfirm(false);
          void navigate({
            to: "/collections/$collection",
            params: { collection },
            ignoreBlocker: true,
          });
        },
      },
    );
  };

  // Rename and duplicate operate on the stored entry and land on the new id.
  const openMoved = (newId: string) => {
    setShowRename(false);
    setShowDuplicate(false);
    void navigate({
      to: "/collections/$collection/$entry",
      params: { collection, entry: newId },
      ignoreBlocker: true,
    });
  };

  const handleRename = (newId: string) => {
    run(
      renameMutation,
      { oldId: entryId, newId, expectedVersion: baselineVersion.current },
      { success: t(($) => $.entry.entryRenamed), onSuccess: () => openMoved(newId) },
    );
  };

  // Seeding a translation is the same move as a duplicate, only the target id is
  // the sibling locale rather than a name the user types.
  const duplicateTo = (newId: string, success: string) => {
    run(
      duplicateMutation,
      { sourceId: entryId, newId },
      { success, onSuccess: () => openMoved(newId) },
    );
  };

  const handleBodyChange = useCallback((value: string) => {
    setEditBody(value);
    setBodyDirty(true);
  }, []);

  const markDirty = useCallback(() => setBodyDirty(true), []);

  if (error) {
    return <ErrorBanner>{t(($) => $.entry.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  if (!format) return <EntrySkeleton />;

  // A new entry is written where the id puts it, an existing one stays in its file.
  const contentFilePath = entry?.path ?? (meta && entryFilePath(meta, entryId, format));

  return (
    <EntryContextProvider value={contentFilePath}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          title={
            <>
              {singleton ? collectionLabel(collection) : label}
              <span className="ml-2 text-sm font-normal text-muted-foreground">.{format}</span>
            </>
          }
          description={singleton ? collectionDescription(collection) : undefined}
          actions={
            <>
              <HistoryControls />
              <SaveActions
                dirty={isDirty}
                saving={saveMutation.isPending}
                onCancel={handleCancel}
                onSave={handleSave}
                shortcut="page"
              />
              {!isNew && !singleton && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowRename(true)}
                    disabled={isDirty || renameMutation.isPending}
                  >
                    {t(($) => $.common.rename)}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowDuplicate(true)}
                    disabled={isDirty || duplicateMutation.isPending}
                  >
                    {t(($) => $.entry.duplicate)}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleteMutation.isPending}
                  >
                    {t(($) => $.common.delete)}
                  </Button>
                </>
              )}
            </>
          }
        >
          {i18n && entryLocale && (
            <LocaleTabs
              collection={collection}
              tabs={translationsOf(i18n.ids, slug, i18n.locales).map(({ locale, id, exists }) => ({
                locale,
                entry: id,
                exists,
              }))}
              active={entryLocale}
              canCreate={!isNew && !isDirty && !duplicateMutation.isPending}
              onCreate={(id) =>
                duplicateTo(
                  id,
                  t(($) => $.i18n.translationCreated),
                )
              }
            />
          )}
        </PageHeader>

        <div inert={saveMutation.isPending} className="flex min-h-0 flex-1 gap-6">
          <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto">
            {shape && <EntryFields form={form} />}
            {!DATA_FORMATS.some((dataFormat) => dataFormat === format) && (
              <MdxEditor
                // Each entry has an editor, and a history, of its own.
                key={`${form}/${editorKey}`}
                ref={bodyRef}
                markdown={editBody}
                onChange={handleBodyChange}
                onDirty={markDirty}
                // Markdoc bodies are plain Markdown to the editor.
                format={format === "mdx" ? "mdx" : "md"}
              />
            )}
          </div>
          <InspectorPanel />
        </div>

        <ConfirmDialog
          open={showDeleteConfirm}
          title={t(($) => $.entry.deleteEntry)}
          description={t(($) => $.entry.deleteEntryMessage, { id: entryId })}
          confirmLabel={t(($) => $.common.delete)}
          pendingLabel={t(($) => $.common.deleting)}
          isPending={deleteMutation.isPending}
          variant="destructive"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />

        <EntryIdDialog
          open={showRename}
          title={t(($) => $.entry.renameEntry)}
          confirmLabel={t(($) => $.common.rename)}
          initialValue={entryId}
          requireChange
          existingIds={entryIds}
          pendingLabel={t(($) => $.common.renaming)}
          isPending={renameMutation.isPending}
          onSubmit={handleRename}
          onCancel={() => setShowRename(false)}
        />

        <EntryIdDialog
          open={showDuplicate}
          title={t(($) => $.entry.duplicateEntry)}
          confirmLabel={t(($) => $.entry.duplicate)}
          initialValue={`${entryId}-copy`}
          existingIds={entryIds}
          pendingLabel={t(($) => $.common.duplicating)}
          isPending={duplicateMutation.isPending}
          onSubmit={(newId) =>
            duplicateTo(
              newId,
              t(($) => $.entry.entryDuplicated),
            )
          }
          onCancel={() => setShowDuplicate(false)}
        />

        <UnsavedChangesDialog blocker={blocker} />
      </div>
    </EntryContextProvider>
  );
}
