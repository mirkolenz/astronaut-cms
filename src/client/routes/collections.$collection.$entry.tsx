import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
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
import { UnsavedChangesDialog, useUnsavedChangesBlocker } from "@/client/components/unsaved-changes-dialog";
import { EntryIdDialog } from "@/client/components/entry-id-dialog";
import { toast } from "@/client/components/toast";
import { useWriteError } from "@/client/lib/write-error";
import { ErrorBanner } from "@/client/components/error-banner";
import { DATA_FORMATS, entryFilePath } from "@/shared/types";
import { EntryContextProvider } from "@/client/lib/entry-context";
import { baseName } from "@/client/lib/entry-tree";
import { splitLocale } from "@/shared/i18n";
import { useCollectionI18n } from "@/client/lib/content-i18n";
import { TranslationSwitcher } from "@/client/components/translation-switcher";
import { Button } from "@/client/components/ui/button";
import config from "@/client/lib/config";
import { collectionLabel, collectionSingleton } from "@/client/lib/collections";
import { asEntryFormat, type EntryFormat } from "@/shared/types";
import { Skeleton } from "@/client/components/ui/skeleton";

export const Route = createFileRoute("/collections/$collection/$entry")({
  component: EntryEditor,
  // `new` carries the format of an entry that does not exist yet: the editor
  // holds it as a draft and the first save creates it.
  validateSearch: (search: Record<string, unknown>): { new?: EntryFormat } => {
    const format = typeof search.new === "string" ? asEntryFormat(search.new) : null;

    return format ? { new: format } : {};
  },
});

function EntryEditor() {
  const { t } = useTranslation();
  const { collection, entry: entryId } = Route.useParams();
  const { new: newFormat } = Route.useSearch();
  const isNew = newFormat !== undefined;
  const navigate = useNavigate();
  const writeError = useWriteError();
  const { data: entry, isLoading, error } = useEntry(collection, entryId, { enabled: !isNew });
  const { data: entries } = useEntries(collection);
  const saveMutation = useSaveEntry(collection, entryId);
  const deleteMutation = useDeleteEntry(collection);
  const renameMutation = useRenameEntry(collection);
  const duplicateMutation = useDuplicateEntry(collection);

  const meta = config.collections[collection];
  const singleton = collectionSingleton(collection) !== null;
  const shape = objectShape(meta?.schema);
  const format = entry?.format ?? newFormat;
  const form = `${collection}/${entryId}`;
  const label = baseName(entryId);
  const [editBody, setEditBody] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);

  const entryIds = (entries ?? []).map((e) => e.id);
  const otherIds = entryIds.filter((id) => id !== entryId);
  const i18n = useCollectionI18n(entries);
  const { locale: entryLocale, slug } = splitLocale(entryId, i18n?.locales ?? []);

  const [bodyDirty, setBodyDirty] = useState(false);
  const formDirty = useFormDirty(form);
  // A draft has nothing saved yet, so it starts dirty: Save is what creates it.
  const isDirty = isNew || formDirty || bodyDirty;
  const baselineVersion = useRef<string | undefined>(undefined);

  // The fields and their history start over with each entry.
  useEffect(() => () => resetForms(), [form]);

  useEffect(() => {
    if (isNew) openForm(form, { values: schemaDefaults(shape), saved: null, shape: shape ?? {}, label });
  }, [form, isNew, shape, label]);

  useEffect(() => {
    if (entry && !isDirty) {
      openForm(form, { values: entry.data, saved: entry.data, shape: shape ?? {}, label });
      setEditBody(entry.body);
      baselineVersion.current = entry.version;
    }
  }, [entry, isDirty, form, shape, label]);

  // Leaving the page drops the history, so unsaved changes are confirmed first.
  const blocker = useUnsavedChangesBlocker(isDirty);

  const bodyRef = useRef<MdxEditorHandle>(null);

  // Use ref for save to avoid event listener churn
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => {
    // Read from the editor, which holds an edit inside a component before `editBody` does.
    const body = bodyRef.current?.flush() ?? editBody;
    const data = getForm(form)?.values ?? {};

    if (!format || !isDirty) return;

    saveMutation.mutate(
      // The version this edit was made against, so a save cannot silently
      // discard one that landed while the editor was open. A new entry has none:
      // there is nothing yet for it to have been based on.
      {
        data,
        body,
        format,
        createOnly: isNew,
        expectedVersion: baselineVersion.current,
      },
      {
        onSuccess: ({ version }) => {
          baselineVersion.current = version;
          markSaved(form, data);
          setBodyDirty(false);
          toast(
            isNew ? t(($) => $.collection.entryCreated) : t(($) => $.entry.changesSaved),
            "success",
          );

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
        onError: (err) => toast(writeError(err), "error"),
      },
    );
  };

  const handleSave = useCallback(() => saveRef.current(), []);

  const [editorKey, setEditorKey] = useState(0);

  const handleCancel = useCallback(() => {
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
  }, [collection, entry, isNew, navigate, form, shape, label]);

  const handleDelete = () => {
    deleteMutation.mutate(
      { id: entryId, expectedVersion: baselineVersion.current },
      {
        onSuccess: () => {
          toast(
            t(($) => $.collection.entryDeleted),
            "success",
          );
          void navigate({
            to: "/collections/$collection",
            params: { collection },
          });
        },
        onError: (err) => toast(writeError(err), "error"),
      },
    );
    setShowDeleteConfirm(false);
  };

  // Rename and duplicate operate on the stored entry, landing on the new id, and
  // share the same success (toast + navigate) and error handling.
  const onMoved = (newId: string, message: string) => ({
    onSuccess: () => {
      toast(message, "success");
      void navigate({
        to: "/collections/$collection/$entry",
        params: { collection, entry: newId },
      });
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const handleRename = (newId: string) => {
    setShowRename(false);
    renameMutation.mutate(
      { oldId: entryId, newId, expectedVersion: baselineVersion.current },
      onMoved(
        newId,
        t(($) => $.entry.entryRenamed),
      ),
    );
  };

  // Seeding a translation is the same move as a duplicate, only the target id is
  // the sibling locale rather than a name the user types.
  const duplicateTo = (newId: string, message: string) => {
    setShowDuplicate(false);
    duplicateMutation.mutate({ sourceId: entryId, newId }, onMoved(newId, message));
  };

  const handleBodyChange = useCallback((value: string) => {
    setEditBody(value);
    setBodyDirty(true);
  }, []);

  const markDirty = useCallback(() => setBodyDirty(true), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>{t(($) => $.entry.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  if (!format) return null;

  const isContentFormat = !(DATA_FORMATS as readonly string[]).includes(format);

  // A new entry is written where the id puts it, an existing one stays in its file.
  const contentFilePath = entry?.path ?? (meta && entryFilePath(meta, entryId, format));

  return (
    <EntryContextProvider value={contentFilePath ? { contentFilePath } : null}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {singleton ? collectionLabel(collection) : baseName(entryId)}
              <span className="ml-2 text-sm font-normal text-muted-foreground">.{format}</span>
            </h1>
            {singleton && meta?.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
            )}
            {i18n && entryLocale && (
              <div className="mt-1.5">
                <TranslationSwitcher
                  collection={collection}
                  i18n={i18n}
                  slug={slug}
                  active={entryLocale}
                  canCreate={!isNew && !isDirty && !duplicateMutation.isPending}
                  onCreate={(id) =>
                    duplicateTo(
                      id,
                      t(($) => $.i18n.translationCreated),
                    )
                  }
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <HistoryControls />
            <Button variant="outline" onClick={handleCancel} disabled={(!isNew && !isDirty) || saveMutation.isPending}>
              {t(($) => $.common.cancel)}
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending || !isDirty}>
              {saveMutation.isPending ? t(($) => $.common.saving) : t(($) => $.common.save)}
            </Button>
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
          </div>
        </div>

        <div inert={saveMutation.isPending} className="flex min-h-0 flex-1 gap-6">
          <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto">
            {shape && (
              <EntryFields form={form} />
            )}
            {isContentFormat && (
              <MdxEditor
                // Each entry has an editor, and a history, of its own.
                key={`${form}/${editorKey}`}
                ref={bodyRef}
                markdown={editBody}
                onChange={handleBodyChange}
                onDirty={markDirty}
                format={format as "md" | "mdx"}
              />
            )}
          </div>
          <InspectorPanel />
        </div>

        <ConfirmDialog
          open={showDeleteConfirm}
          title={t(($) => $.entry.deleteEntry)}
          message={t(($) => $.entry.deleteEntryMessage, { id: entryId })}
          confirmLabel={t(($) => $.common.delete)}
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />

        <EntryIdDialog
          open={showRename}
          title={t(($) => $.entry.renameEntry)}
          confirmLabel={t(($) => $.common.rename)}
          initialId={entryId}
          existingIds={otherIds}
          onSubmit={handleRename}
          onCancel={() => setShowRename(false)}
        />

        <EntryIdDialog
          open={showDuplicate}
          title={t(($) => $.entry.duplicateEntry)}
          confirmLabel={t(($) => $.entry.duplicate)}
          initialId={`${entryId}-copy`}
          existingIds={entryIds}
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
