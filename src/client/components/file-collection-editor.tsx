import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ChevronUp, FileText, Trash2 } from "lucide-react";
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
import { EntryFields } from "@/client/components/editors/entry-fields";
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
  const [dirtyEntries, setDirtyEntries] = useState<Set<string>>(new Set());
  const blocker = useUnsavedChangesBlocker(dirtyEntries.size > 0);

  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyEntries((previous) => {
      if (previous.has(id) === dirty) return previous;

      const next = new Set(previous);

      if (dirty) next.add(id);
      else next.delete(id);

      return next;
    });
  }, []);

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
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{toLabel(collection)}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t(($) => $.collection.fileCollection)} &middot;{" "}
              {t(($) => $.collection.entries, { count: sortedEntries?.length ?? 0 })}
            </p>
          </div>
          <Button onClick={() => setShowAddDialog(true)} disabled={draftId !== null}>
            {t(($) => $.collection.addEntry)}
          </Button>
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
              onDirtyChange={onDirtyChange}
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
              onDirtyChange={onDirtyChange}
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
    </EntryContextProvider>
  );
}

function FileEntryCard({
  collection,
  entryId,
  schema,
  onDirtyChange,
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
  onDirtyChange: (id: string, dirty: boolean) => void;
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
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    draft ? schemaDefaults(objectShape(schema)) : {},
  );
  const [isDirty, setIsDirty] = useState(!!draft);
  const baselineVersion = useRef<string | undefined>(undefined);
  const baselineData = useRef<string | undefined>(undefined);

  useEffect(() => {
    const dirtyKey = draft ? `draft:${entryId}` : entryId;

    onDirtyChange(dirtyKey, isDirty);

    return () => onDirtyChange(dirtyKey, false);
  }, [draft, entryId, isDirty, onDirtyChange]);

  useEffect(() => {
    if (!entry) return;

    const serialized = JSON.stringify(entry.data);

    if (!isDirty) {
      setFormData(entry.data);
      baselineData.current = serialized;
      baselineVersion.current = entry.version;

      return;
    }

    // A sibling changed the container, but this entry still matches the data
    // the edit began from. The next save may use the container's new version.
    if (serialized === baselineData.current) baselineVersion.current = entry.version;
  }, [entry, isDirty]);

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }, []);

  const handleSave = () => {
    const entryFormat = entry?.format ?? format;

    if (!entryFormat) return;

    saveMutation.mutate(
      // In a file collection this is the container's version, which every entry
      // in it shares, so the guard covers a sibling saved while this one was open.
      {
        data: formData,
        body: "",
        format: entryFormat,
        createOnly: !!draft,
        expectedVersion: baselineVersion.current,
      },
      {
        onSuccess: ({ version }) => {
          baselineVersion.current = version;
          setIsDirty(false);
          toast(draft ? t(($) => $.entry.entryAdded) : t(($) => $.entry.changesSaved), "success");
          onCreated?.();
        },
        onError: (err) => toast(writeError(err), "error"),
      },
    );
  };

  const shape = objectShape(schema) ?? {};

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
          {orderable && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onMoveDown}
                disabled={!onMoveDown}
              >
                <ChevronDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onMoveUp}
                disabled={!onMoveUp}
              >
                <ChevronUp className="size-4" />
              </Button>
            </>
          )}
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
              <EntryFields shape={shape} data={formData} onChange={handleFieldChange} />
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
