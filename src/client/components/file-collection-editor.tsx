import { useState, useCallback, useEffect, useMemo } from "react";
import {
  useEntries,
  useEntry,
  useSaveEntry,
  useCreateEntry,
  useDeleteEntry,
  useFileLayout,
  useReorderFileEntries,
} from "@/client/queries/use-entries";
import { useCollections } from "@/client/queries/use-collections";
import { FieldRenderer, type ZodFieldSchema } from "@/client/components/editors/field-renderer";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { NewEntryDialog } from "@/client/components/new-entry-dialog";
import { ErrorBanner } from "@/client/components/error-banner";
import { toast } from "@/client/components/toast";
import { toLabel } from "@/client/lib/to-label";
import { getFileExtension } from "@/shared/content-parser";
import collectionMeta from "virtual:astronaut-cms/collections";

const moveButtonClass =
  "px-1.5 py-2 text-sm text-gray-400 hover:text-gray-700 disabled:invisible dark:hover:text-gray-200";

export function FileCollectionEditor({ collection }: { collection: string }) {
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
        toast("Delete staged", "success");
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
            className="h-16 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>Failed to load entries: {error.message}</ErrorBanner>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{toLabel(collection)}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            File collection &middot; {sortedEntries?.length ?? 0} entries
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Add Entry
        </button>
      </div>

      {(!sortedEntries || sortedEntries.length === 0) && (
        <div className="text-center text-gray-500">
          <p>No entries yet</p>
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
                toast("Entry added", "success");
              },
              onError: (err) => toast(err.message, "error"),
            },
          );
        }}
        onCancel={() => setShowAddDialog(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove entry"
        message={`Are you sure you want to remove "${deleteTarget}"? This will be applied on publish.`}
        confirmLabel="Remove"
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
          toast("Changes staged", "success");
        },
        onError: (err) => toast(err.message, "error"),
      },
    );
  };

  const shape = schema?.shape ?? {};

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-900"
        >
          <span className="text-xs text-gray-400">{expanded ? "\u25BC" : "\u25B6"}</span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{entryId}</span>
          {isDirty && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              modified
            </span>
          )}
        </button>
        <div className="flex items-center border-l border-gray-200 dark:border-gray-700">
          {orderable && (
            <>
              <button type="button" onClick={onMoveDown} disabled={!onMoveDown} className={moveButtonClass}>
                {"\u25BC"}
              </button>
              <button type="button" onClick={onMoveUp} disabled={!onMoveUp} className={moveButtonClass}>
                {"\u25B2"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
            title="Delete entry"
          >
            {"\uD83D\uDDD1"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {isLoading ? (
            <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
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
                <p className="text-sm text-gray-400">No schema available.</p>
              )}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending || !isDirty}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
