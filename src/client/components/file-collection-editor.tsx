import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ChevronUp, Trash2 } from "lucide-react";
import {
  useEntries,
  useEntry,
  useSaveEntry,
  useCreateEntry,
  useDeleteEntry,
  useFileLayout,
  useReorderFileEntries,
} from "@client/queries/use-entries";
import { useCollections } from "@client/queries/use-collections";
import { FieldRenderer, type ZodFieldSchema } from "@client/components/editors/field-renderer";
import { ConfirmDialog } from "@client/components/confirm-dialog";
import { NewEntryDialog } from "@client/components/new-entry-dialog";
import { ErrorBanner } from "@client/components/error-banner";
import { toast } from "@client/components/toast";
import { toLabel } from "@client/lib/to-label";
import { getFileExtension } from "@shared/content-parser";
import { Button } from "@client/components/ui/button";
import { Badge } from "@client/components/ui/badge";
import collectionMeta from "virtual:astronaut-cms/collections";

export function FileCollectionEditor({ collection }: { collection: string }) {
  const { t } = useTranslation();
  const { data: entries, isLoading, error } = useEntries(collection);
  const { data: collections } = useCollections();
  const schema = collections?.[collection]?.schema as ZodFieldSchema | undefined;
  const meta = collectionMeta[collection];
  const format = (meta?.loaderFileName && getFileExtension(meta.loaderFileName)) || "json";
  const { data: layout } = useFileLayout(collection);
  const isOrderable = layout === "array";

  const createMutation = useCreateEntry(collection);
  const deleteMutation = useDeleteEntry(collection);
  const reorderMutation = useReorderFileEntries(collection);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const sortedEntries = useMemo(() => {
    if (!entries) return undefined;
    if (layout === "object") return [...entries].sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  }, [entries, layout]);

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
    reorderMutation.mutate(ids, { onError: (err) => toast(err.message, "error") });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, {
      onSuccess: () => {
        toast(t($ => $.collection.deleteStaged), "success");
        setDeleteTarget(null);
      },
      onError: (err) => toast(err.message, "error"),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border bg-muted"
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
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t($ => $.collection.fileCollection)} &middot; {t($ => $.collection.entries, { count: sortedEntries?.length ?? 0 })}
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          {t($ => $.collection.addEntry)}
        </Button>
      </div>

      {(!sortedEntries || sortedEntries.length === 0) && (
        <div className="text-center text-muted-foreground">
          <p>{t($ => $.collection.noEntries)}</p>
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
            onDelete={() => setDeleteTarget(entry.id)}
            orderable={isOrderable}
            onMoveUp={index > 0 ? () => handleMove(index, -1) : undefined}
            onMoveDown={index < sortedEntries.length - 1 ? () => handleMove(index, 1) : undefined}
          />
        ))}
      </div>

      <NewEntryDialog
        open={showAddDialog}
        collection={collection}
        collectionType="data"
        allowedFormats={[format]}
        onSubmit={(id) => {
          createMutation.mutate(
            { id, format },
            {
              onSuccess: () => {
                setShowAddDialog(false);
                toast(t($ => $.entry.entryAdded), "success");
              },
              onError: (err) => toast(err.message, "error"),
            },
          );
        }}
        onCancel={() => setShowAddDialog(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t($ => $.editors.removeEntry)}
        message={t($ => $.editors.removeEntryMessage, { id: deleteTarget ?? "" })}
        confirmLabel={t($ => $.common.remove)}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function FileEntryCard({
  collection,
  entryId,
  schema,
  expanded,
  onToggle,
  onDelete,
  orderable,
  onMoveUp,
  onMoveDown,
}: {
  collection: string;
  entryId: string;
  schema?: ZodFieldSchema;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  orderable: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const { t } = useTranslation();
  const { data: entry, isLoading } = useEntry(collection, entryId, { enabled: expanded });
  const saveMutation = useSaveEntry(collection, entryId);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData(entry.data);
      setIsDirty(false);
    }
  }, [entry]);

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }, []);

  const handleSave = () => {
    if (!entry) return;
    saveMutation.mutate(
      { data: formData, body: "", format: entry.format },
      {
        onSuccess: () => {
          setIsDirty(false);
          toast(t($ => $.entry.changesStaged), "success");
        },
        onError: (err) => toast(err.message, "error"),
      },
    );
  };

  const shape = schema?.shape ?? {};

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          onClick={onToggle}
          className="flex flex-1 items-center justify-start gap-2 rounded-none px-4 py-3 text-left"
        >
          {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          <span className="text-sm font-medium text-foreground">{entryId}</span>
          {isDirty && (
            <Badge variant="outline">
              {t($ => $.entry.modified)}
            </Badge>
          )}
        </Button>
        <div className="flex items-center border-l border-border">
          {orderable && (
            <>
              <Button type="button" variant="ghost" size="icon-xs" onClick={onMoveDown} disabled={!onMoveDown}>
                <ChevronDown className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" onClick={onMoveUp} disabled={!onMoveUp}>
                <ChevronUp className="size-4" />
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-destructive"
            onClick={onDelete}
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
                  required={fieldSchema.def.type !== "optional"}
                />
              ))}
              {Object.keys(shape).length === 0 && (
                <p className="text-sm text-muted-foreground">{t($ => $.entry.noSchemaShort)}</p>
              )}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending || !isDirty}
            >
              {saveMutation.isPending ? t($ => $.common.saving) : t($ => $.common.save)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
