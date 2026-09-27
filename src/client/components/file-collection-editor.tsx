import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ChevronUp, Trash2 } from "lucide-react";
import {
  useEntries,
  useEntry,
  useSaveEntry,
  useDeleteEntry,
  useFileLayout,
  useReorderFileEntries,
} from "@/client/queries/use-entries";
import { useWriteError } from "@/client/lib/write-error";
import { FieldRenderer } from "@/client/components/editors/field-renderer";
import { isRequired, objectShape, type FieldSchema } from "@/shared/field-schema";
import { schemaDefaults } from "@/shared/collection-schema";
import { asEntryFormat, sortByIds, type EntryFormat } from "@/shared/types";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { NewEntryDialog } from "@/client/components/new-entry-dialog";
import { ErrorBanner } from "@/client/components/error-banner";
import { EntryContextProvider } from "@/client/lib/entry-context";
import { toast } from "@/client/components/toast";
import { toLabel } from "@/client/lib/to-label";
import { getFileExtension } from "@/shared/content-parser";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import config from "@/client/lib/config";

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
    if (targetIndex < 0 || targetIndex >= sortedEntries.length) return;
    const ids = sortedEntries.map((e) => e.id);
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    reorderMutation.mutate(
      { ids, expectedVersion: file?.version },
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
          <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-muted" />
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
          <Button onClick={() => setShowAddDialog(true)}>{t(($) => $.collection.addEntry)}</Button>
        </div>

        {(!sortedEntries || sortedEntries.length === 0) && (
          <div className="text-center text-muted-foreground">
            <p>{t(($) => $.collection.noEntries)}</p>
          </div>
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
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    draft ? schemaDefaults(objectShape(schema)) : {},
  );
  const [isDirty, setIsDirty] = useState(!!draft);
  const baselineVersion = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (entry && !isDirty) {
      setFormData(entry.data);
      baselineVersion.current = entry.version;
    }
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
    <div className="rounded-lg border border-border">
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
        <div className="border-t border-border px-4 py-3">
          {isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : (
            <div className="space-y-3">
              {Object.entries(shape).map(([key, fieldSchema]) => (
                <FieldRenderer
                  key={key}
                  schema={fieldSchema}
                  value={formData[key]}
                  onChange={(v) => handleFieldChange(key, v)}
                  name={key}
                  required={isRequired(fieldSchema)}
                />
              ))}
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
    </div>
  );
}
