import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FileText, Trash2 } from "lucide-react";
import { Card } from "@/client/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";
import {
  useEntries,
  useEntry,
  useSaveEntry,
  useDeleteEntry,
  useFileLayout,
  useReorderFileEntries,
} from "@/client/queries/use-entries";
import { useWriteError } from "@/client/lib/write-error";
import { EntryFields } from "@/client/components/editors/field-inspector";
import { InspectorPanel } from "@/client/components/editors/component-inspector";
import { MoveButtons } from "@/client/components/editors/block-controls";
import { HistoryControls } from "@/client/components/editors/history-controls";
import {
  closeForm,
  getForm,
  markSaved,
  openForm,
  resetForms,
  useAnyFormDirty,
  useFormDirty,
} from "@/client/stores/form-store";
import { objectShape, type FieldSchema } from "@/shared/field-schema";
import { schemaDefaults } from "@/shared/collection-schema";
import { asEntryFormat, sortByIds, type EntryFormat } from "@/shared/types";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { UnsavedChangesDialog, useUnsavedChangesBlocker } from "@/client/components/unsaved-changes-dialog";
import { NewEntryDialog } from "@/client/components/new-entry-dialog";
import { ErrorBanner } from "@/client/components/error-banner";
import { EntryContextProvider } from "@/client/lib/entry-context";
import { toast } from "@/client/components/toast";
import { toLabel } from "@/client/lib/to-label";
import { getFileExtension } from "@/shared/content-parser";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import config from "@/client/lib/config";
import { Skeleton } from "@/client/components/ui/skeleton";

const NO_FIELDS: Record<string, FieldSchema> = {};

export function FileCollectionEditor({ collection }: { collection: string }) {
  const { t } = useTranslation();
  const { data: entries, isLoading, error } = useEntries(collection);
  const meta = config.collections[collection];
  const schema = meta?.schema ?? undefined;
  const format =
    (meta?.loaderFileName && asEntryFormat(getFileExtension(meta.loaderFileName))) || "json";
  const { data: file } = useFileLayout(collection);
  // Every entry of a file collection lives in the same file, so a relative asset
  // reference in any of them resolves against that one path.
  const contentFilePath = meta?.loaderFileName;
  // Only file order is the editors' to change: any other is derived from the ids.
  const sort = meta?.sort ?? "id";
  const isOrderable = sort === "file";

  const writeError = useWriteError();
  const deleteMutation = useDeleteEntry(collection);
  const reorderMutation = useReorderFileEntries(collection);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    expectedVersion?: string;
  } | null>(null);
  // A new entry is held here until its first save creates it, so an abandoned
  // one never lands in the file as an empty (schema-invalid) record.
  const [draftId, setDraftId] = useState<string | null>(null);
  // Leaving the page drops the history, so unsaved changes are confirmed first.
  const blocker = useUnsavedChangesBlocker(useAnyFormDirty());

  // The entries and their history start over with each collection.
  useEffect(() => () => resetForms(), [collection]);

  const sortedEntries = useMemo(() => entries && sortByIds(entries, sort), [entries, sort]);

  const toggleEntry = (id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    if (!sortedEntries) return;
    const targetIndex = index + direction;
    const ids = sortedEntries.map((e) => e.id);
    const current = ids[index];
    const target = ids[targetIndex];
    if (current === undefined || target === undefined) return;
    reorderMutation.mutate(
      { ids: ids.with(index, target).with(targetIndex, current), expectedVersion: file?.version },
      { onError: (err) => toast(writeError(err), "error") },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      {
        id: deleteTarget.id,
        expectedVersion: deleteTarget.expectedVersion ?? file?.version,
      },
      {
        onSuccess: () => {
          toast(
            t(($) => $.collection.entryDeleted),
            "success",
          );
          setDeleteTarget(null);
        },
        onError: (err) => toast(writeError(err), "error"),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
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
    <EntryContextProvider value={contentFilePath ? { contentFilePath } : null}>
      <div className="flex min-h-0 flex-1 gap-6">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">{toLabel(collection)}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t(($) => $.collection.fileCollection)} &middot;{" "}
                {t(($) => $.collection.entries, { count: sortedEntries?.length ?? 0 })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <HistoryControls />
              <Button onClick={() => setShowAddDialog(true)} disabled={draftId !== null}>
                {t(($) => $.collection.addEntry)}
              </Button>
            </div>
          </div>

          {(!sortedEntries || sortedEntries.length === 0) && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText />
                </EmptyMedia>
                <EmptyTitle>{t(($) => $.collection.noEntries)}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}

          <div className="space-y-2">
            {sortedEntries?.map((entry, index) => (
              <FileEntryCard
                key={entry.id}
                collection={collection}
                entryId={entry.id}
                schema={schema}
                expanded={expandedEntries.has(entry.id)}
                onToggle={() => toggleEntry(entry.id)}
                onDelete={(expectedVersion) => setDeleteTarget({ id: entry.id, expectedVersion })}
                orderable={isOrderable}
                onMoveUp={index > 0 ? () => handleMove(index, -1) : undefined}
                onMoveDown={index < sortedEntries.length - 1 ? () => handleMove(index, 1) : undefined}
              />
            ))}
            {draftId && (
              <FileEntryCard
                key={`draft:${draftId}`}
                collection={collection}
                entryId={draftId}
                schema={schema}
                format={format}
                draft
                expanded
                onToggle={() => setDraftId(null)}
                onDelete={() => setDraftId(null)}
                onCreated={() => setDraftId(null)}
                orderable={false}
              />
            )}
          </div>

          <NewEntryDialog
            open={showAddDialog}
            collection={collection}
            collectionType="data"
            allowedFormats={[format]}
            onSubmit={(id) => {
              setShowAddDialog(false);
              setDraftId(id);
            }}
            onCancel={() => setShowAddDialog(false)}
          />

          <ConfirmDialog
            open={deleteTarget !== null}
            title={t(($) => $.editors.removeEntry)}
            message={t(($) => $.editors.removeEntryMessage, { id: deleteTarget?.id ?? "" })}
            confirmLabel={t(($) => $.common.remove)}
            variant="danger"
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />

          <UnsavedChangesDialog blocker={blocker} />
        </div>
        <InspectorPanel />
      </div>
    </EntryContextProvider>
  );
}

function FileEntryCard({
  collection,
  entryId,
  schema,
  format,
  draft,
  expanded,
  onToggle,
  onDelete,
  onCreated,
  orderable,
  onMoveUp,
  onMoveDown,
}: {
  collection: string;
  entryId: string;
  schema?: FieldSchema;
  /** File format, needed for a draft that has nothing stored to read it from. */
  format?: EntryFormat;
  /** This entry does not exist yet; saving creates it. */
  draft?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (expectedVersion?: string) => void;
  onCreated?: () => void;
  orderable: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const { t } = useTranslation();
  const { data: entry, isLoading } = useEntry(collection, entryId, {
    enabled: expanded && !draft,
  });
  const saveMutation = useSaveEntry(collection, entryId);
  const writeError = useWriteError();
  const shape = objectShape(schema) ?? NO_FIELDS;
  const form = `${collection}/${draft ? "draft:" : ""}${entryId}`;
  const isDirty = useFormDirty(form);
  const baselineVersion = useRef<string | undefined>(undefined);
  const baselineData = useRef<string | undefined>(undefined);

  // A draft opens with the defaults, saved as nothing yet.
  useEffect(() => {
    if (draft) openForm(form, { values: schemaDefaults(shape), saved: null, shape, label: entryId });

    return () => closeForm(form);
  }, [form, draft, shape, entryId]);

  useEffect(() => {
    if (!entry) return;

    const serialized = JSON.stringify(entry.data);

    if (!isDirty) {
      openForm(form, { values: entry.data, saved: entry.data, shape, label: entryId });
      baselineData.current = serialized;
      baselineVersion.current = entry.version;

      return;
    }

    // A sibling changed the container, but this entry still matches the data
    // the edit began from. The next save may use the container's new version.
    if (serialized === baselineData.current) baselineVersion.current = entry.version;
  }, [entry, isDirty, form, shape, entryId]);

  const handleSave = () => {
    const entryFormat = entry?.format ?? format;
    const data = getForm(form)?.values ?? {};

    if (!entryFormat) return;

    saveMutation.mutate(
      // In a file collection this is the container's version, which every entry
      // in it shares, so the guard covers a sibling saved while this one was open.
      {
        data,
        body: "",
        format: entryFormat,
        createOnly: !!draft,
        expectedVersion: baselineVersion.current,
      },
      {
        onSuccess: ({ version }) => {
          baselineVersion.current = version;
          markSaved(form, data);
          toast(draft ? t(($) => $.entry.entryAdded) : t(($) => $.entry.changesSaved), "success");
          onCreated?.();
        },
        onError: (err) => toast(writeError(err), "error"),
      },
    );
  };

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          onClick={onToggle}
          className="flex flex-1 items-center justify-start gap-2 rounded-none px-4 py-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium text-foreground">{entryId}</span>
          {isDirty && <Badge variant="outline">{t(($) => $.entry.modified)}</Badge>}
        </Button>
        <div className="flex items-center border-l border-border">
          {orderable && <MoveButtons moves={{ [-1]: onMoveUp, [1]: onMoveDown }} />}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-destructive"
            onClick={() => onDelete(baselineVersion.current)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div inert={saveMutation.isPending} className="border-t border-border px-4 py-3">
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="space-y-3">
              <EntryFields form={form} />
              {Object.keys(shape).length === 0 && (
                <p className="text-sm text-muted-foreground">{t(($) => $.entry.noSchemaShort)}</p>
              )}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending || !isDirty}
            >
              {saveMutation.isPending ? t(($) => $.common.saving) : t(($) => $.common.save)}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
