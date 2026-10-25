import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Trash2 } from "lucide-react";
import { CollapsibleContent } from "@/client/components/ui/collapsible";
import { ItemActions, ItemTitle } from "@/client/components/ui/item";
import { CollapsibleItem } from "@/client/components/collapsible-item";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/client/components/ui/empty";
import {
  useEntry,
  useSaveEntry,
  useDeleteEntry,
  useFileLayout,
  useReorderFileEntries,
} from "@/client/queries/use-entries";
import { EntryFields } from "@/client/components/editors/field-inspector";
import { InspectorPanel } from "@/client/components/editors/component-inspector";
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
import {
  asEntryFormat,
  sortByIds,
  type EntryContent,
  type EntryFormat,
  type EntryMeta,
} from "@/shared/types";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import {
  UnsavedChangesDialog,
  useUnsavedChangesBlocker,
} from "@/client/components/unsaved-changes-dialog";
import { NewEntryDialog } from "@/client/components/new-entry-dialog";
import { IconButton } from "@/client/components/icon-button";
import { PageHeader } from "@/client/components/page-header";
import { SaveActions, saveOnKey } from "@/client/components/save-actions";
import { SortableList } from "@/client/components/sortable-list";
import { EntryContextProvider } from "@/client/lib/entry-context";
import { arrayMove } from "@/client/lib/arrays";
import { useRunMutation } from "@/client/hooks/use-run-mutation";
import { collectionDescription, collectionLabel } from "@/client/lib/collections";
import { getFileExtension } from "@/shared/content-parser";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import config from "@/client/lib/config";
import { Skeleton } from "@/client/components/ui/skeleton";

const NO_FIELDS: Record<string, FieldSchema> = {};

const formId = (collection: string, id: string, draft: boolean) =>
  `${collection}/${draft ? "draft:" : ""}${id}`;

/** Every entry of a file collection, each edited and saved on a card of its own. */
export function FileCollectionEditor({
  collection,
  entries,
}: {
  collection: string;
  entries: EntryMeta[];
}) {
  const { t } = useTranslation();
  const run = useRunMutation();
  const meta = config.collections[collection];
  const shape = objectShape(meta?.schema) ?? NO_FIELDS;
  const format =
    (meta?.loaderFileName && asEntryFormat(getFileExtension(meta.loaderFileName))) || "json";
  const { data: file } = useFileLayout(collection);
  // Every entry of a file collection lives in the same file, so a relative asset
  // reference in any of them resolves against that one path.
  const contentFilePath = meta?.loaderFileName ?? undefined;
  // Only file order is the editors' to change: any other is derived from the ids.
  const sort = meta?.sort ?? "id";
  const isOrderable = sort === "file";

  const deleteMutation = useDeleteEntry(collection);
  const reorderMutation = useReorderFileEntries(collection);
  const [expandedEntries, setExpandedEntries] = useState<ReadonlySet<string>>(new Set());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    expectedVersion?: string;
  } | null>(null);
  // A new entry is held here until its first save creates it, so an abandoned
  // one never lands in the file as an empty (schema-invalid) record.
  const [draft, setDraft] = useState<{ id: string; expanded: boolean } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Leaving the page drops the history, so unsaved changes are confirmed first.
  const blocker = useUnsavedChangesBlocker(useAnyFormDirty());

  // Keyed by the collection, so the entries and their history start over with each.
  useLayoutEffect(() => () => resetForms(), []);

  const sortedEntries = useMemo(() => sortByIds(entries, sort), [entries, sort]);

  const toggleEntry = (id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const handleMove = (from: number, to: number) => {
    const ids = arrayMove(
      sortedEntries.map((e) => e.id),
      from,
      to,
    );

    run(reorderMutation, { ids, expectedVersion: file?.version }, {});
  };

  const handleDelete = () => {
    if (!deleteTarget) return;

    run(
      deleteMutation,
      { id: deleteTarget.id, expectedVersion: deleteTarget.expectedVersion ?? file?.version },
      { success: t(($) => $.collection.entryDeleted), onSuccess: () => setDeleteTarget(null) },
    );
  };

  // The one way a draft goes away unsaved, asking first once it holds edits.
  const discardDraft = (confirmed = false) => {
    if (!draft) return;

    const values = getForm(formId(collection, draft.id, true))?.values;

    if (!confirmed && JSON.stringify(values) !== JSON.stringify(schemaDefaults(shape))) {
      setConfirmDiscard(true);

      return;
    }

    setConfirmDiscard(false);
    setDraft(null);
  };

  return (
    <EntryContextProvider value={contentFilePath}>
      <div className="flex min-h-0 flex-1 gap-6">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <PageHeader
            title={collectionLabel(collection)}
            description={`${collectionDescription(collection)} · ${t(($) => $.collection.entries, { count: sortedEntries.length })}`}
            actions={
              <>
                <HistoryControls />
                <Button onClick={() => setShowAddDialog(true)} disabled={draft !== null}>
                  {t(($) => $.collection.newEntry)}
                </Button>
              </>
            }
          />

          {sortedEntries.length === 0 && !draft && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText />
                </EmptyMedia>
                <EmptyTitle>{t(($) => $.collection.noEntries)}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}

          <SortableList
            items={sortedEntries}
            getKey={(entry) => entry.id}
            onMove={isOrderable ? handleMove : undefined}
            disabled={reorderMutation.isPending}
            className="space-y-2"
          >
            {(entry, _, handle) => (
              <FileEntryCard
                collection={collection}
                entryId={entry.id}
                shape={shape}
                expanded={expandedEntries.has(entry.id)}
                handle={handle}
                onToggle={() => toggleEntry(entry.id)}
                onDelete={(expectedVersion) => setDeleteTarget({ id: entry.id, expectedVersion })}
              />
            )}
          </SortableList>

          {draft && (
            <div className="mt-2">
              <FileEntryCard
                key={draft.id}
                collection={collection}
                entryId={draft.id}
                shape={shape}
                format={format}
                draft
                expanded={draft.expanded}
                onToggle={() => setDraft({ ...draft, expanded: !draft.expanded })}
                onDelete={() => discardDraft()}
                onCreated={() => {
                  setDraft(null);
                  setExpandedEntries((prev) => new Set(prev).add(draft.id));
                }}
              />
            </div>
          )}

          <NewEntryDialog
            open={showAddDialog}
            collection={collection}
            collectionType="data"
            allowedFormats={[format]}
            existingIds={entries.map((entry) => entry.id)}
            onSubmit={(id) => {
              setShowAddDialog(false);
              setDraft({ id, expanded: true });
            }}
            onCancel={() => setShowAddDialog(false)}
          />

          <ConfirmDialog
            open={deleteTarget !== null}
            title={t(($) => $.entry.deleteEntry)}
            description={t(($) => $.entry.deleteEntryMessage, { id: deleteTarget?.id ?? "" })}
            confirmLabel={t(($) => $.common.delete)}
            pendingLabel={t(($) => $.common.deleting)}
            isPending={deleteMutation.isPending}
            variant="destructive"
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />

          <ConfirmDialog
            open={confirmDiscard}
            title={t(($) => $.entry.discardDraft)}
            description={t(($) => $.entry.discardDraftMessage, { id: draft?.id ?? "" })}
            confirmLabel={t(($) => $.common.discard)}
            variant="destructive"
            onConfirm={() => discardDraft(true)}
            onCancel={() => setConfirmDiscard(false)}
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
  shape,
  format,
  draft = false,
  expanded,
  handle,
  onToggle,
  onDelete,
  onCreated,
}: {
  collection: string;
  entryId: string;
  shape: Record<string, FieldSchema>;
  /** File format, needed for a draft that has nothing stored to read it from. */
  format?: EntryFormat;
  /** This entry does not exist yet, saving creates it. */
  draft?: boolean;
  expanded: boolean;
  /** The drag handle, for a collection in file order. */
  handle?: ReactNode;
  onToggle: () => void;
  /** Deletes the entry, or discards the draft, which is also what cancelling a draft does. */
  onDelete: (expectedVersion?: string) => void;
  onCreated?: () => void;
}) {
  const { t } = useTranslation();
  const run = useRunMutation();
  const { data: entry, isLoading } = useEntry(collection, entryId, {
    enabled: expanded && !draft,
  });
  const saveMutation = useSaveEntry(collection, entryId);
  const form = formId(collection, entryId, draft);
  const isDirty = useFormDirty(form);
  const baselineVersion = useRef<string | undefined>(undefined);
  const baselineData = useRef<string | undefined>(undefined);

  const load = (stored: EntryContent) => {
    openForm(form, { values: stored.data, saved: stored.data, shape, label: entryId });
    baselineData.current = JSON.stringify(stored.data);
    baselineVersion.current = stored.version;
  };

  // A draft opens with the defaults, saved as nothing yet.
  useLayoutEffect(() => {
    if (draft)
      openForm(form, { values: schemaDefaults(shape), saved: null, shape, label: entryId });

    return () => closeForm(form);
  }, [form, draft, shape, entryId]);

  useLayoutEffect(() => {
    if (!entry) return;

    if (!isDirty) {
      load(entry);

      return;
    }

    // A sibling changed the container, but this entry still matches the data
    // the edit began from. The next save may use the container's new version.
    if (JSON.stringify(entry.data) === baselineData.current)
      baselineVersion.current = entry.version;
  }, [entry, isDirty, form, shape, entryId]);

  const handleSave = () => {
    const entryFormat = entry?.format ?? format;
    const data = getForm(form)?.values ?? {};

    if (!entryFormat) return;

    run(
      saveMutation,
      // In a file collection this is the container's version, which every entry
      // in it shares, so the guard covers a sibling saved while this one was open.
      {
        data,
        body: "",
        format: entryFormat,
        createOnly: draft,
        expectedVersion: baselineVersion.current,
      },
      {
        success: draft ? t(($) => $.collection.entryCreated) : t(($) => $.entry.changesSaved),
        onSuccess: ({ version }) => {
          baselineVersion.current = version;
          markSaved(form, data);
          onCreated?.();
        },
      },
    );
  };

  const handleCancel = () => {
    if (draft) onDelete();
    else if (entry) load(entry);
  };

  const save = { dirty: isDirty, saving: saveMutation.isPending, onSave: handleSave };

  return (
    <CollapsibleItem
      open={expanded}
      onOpenChange={onToggle}
      handle={handle}
      onKeyDown={(event) => saveOnKey(event, save)}
      label={
        <ItemTitle>
          {entryId}
          {isDirty && <Badge variant="outline">{t(($) => $.entry.modified)}</Badge>}
        </ItemTitle>
      }
    >
      <ItemActions>
        <IconButton
          label={draft ? t(($) => $.common.discard) : t(($) => $.entry.deleteEntry)}
          className="text-destructive"
          onClick={() => onDelete(baselineVersion.current)}
        >
          <Trash2 />
        </IconButton>
      </ItemActions>
      <CollapsibleContent inert={save.saving} className="basis-full border-t pt-3">
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
        <div className="mt-3 flex justify-end gap-2">
          <SaveActions
            {...save}
            canCancel={draft || isDirty}
            onCancel={handleCancel}
            shortcut="none"
          />
        </div>
      </CollapsibleContent>
    </CollapsibleItem>
  );
}
