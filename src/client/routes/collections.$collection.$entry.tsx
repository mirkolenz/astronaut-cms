import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@/client/lib/use-debounced-value";
import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useEntry, useSaveEntry, useDeleteEntry } from "@/client/queries/use-entries";
import { useCollections } from "@/client/queries/use-collections";
import { FieldRenderer, type ZodFieldSchema } from "@/client/components/editors/field-renderer";
import { MarkdownEditor } from "@/client/components/editors/markdown-editor";
import { BlockEditor } from "@/client/components/editors/block-editor";
import { PreviewPanel } from "@/client/components/layout/preview-panel";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { toast } from "@/client/components/toast";
import { ErrorBanner } from "@/client/components/error-banner";
import { DATA_FORMATS } from "@/shared/types";
import { EntryContextProvider } from "@/client/lib/entry-context";
import { getContentFilePath } from "@/client/lib/asset-utils";
import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import collectionMeta from "virtual:astronaut-cms/collections";

export const Route = createFileRoute("/collections/$collection/$entry")({
  component: EntryEditor,
});

function EntryEditor() {
  const { t } = useTranslation();
  const { collection, entry: entryId } = Route.useParams();
  const navigate = useNavigate();
  const { data: entry, isLoading, error } = useEntry(collection, entryId);
  const { data: collections } = useCollections();
  const saveMutation = useSaveEntry(collection, entryId);
  const deleteMutation = useDeleteEntry(collection);

  const schema = collections?.[collection]?.schema;
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [editBody, setEditBody] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  const debouncedBody = useDebouncedValue(editBody, 300);

  useEffect(() => {
    if (entry) {
      setFormData(entry.data);
      setEditBody(entry.body);
      setRawJson(JSON.stringify(entry.data, null, 2));
      setIsDirty(false);
    }
  }, [entry]);

  // Block in-app navigation and browser close/refresh when dirty
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });

  // Sync rawJson back to formData on blur
  const syncRawToForm = useCallback(() => {
    try {
      setFormData(JSON.parse(rawJson) as Record<string, unknown>);
    } catch {
      // ignore invalid JSON
    }
  }, [rawJson]);

  // Sync formData to rawJson when switching to raw mode
  useEffect(() => {
    if (showRaw) {
      setRawJson(JSON.stringify(formData, null, 2));
    }
  }, [showRaw]); // intentionally only on toggle, not formData

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Use ref for save to avoid event listener churn
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => {
    if (!entry) return;
    // If in raw mode, sync JSON first
    let data = formData;
    if (showRaw) {
      try {
        data = JSON.parse(rawJson) as Record<string, unknown>;
      } catch {
        toast(t($ => $.entry.invalidJson), "error");
        return;
      }
    }
    saveMutation.mutate(
      { data, body: editBody, format: entry.format },
      {
        onSuccess: () => {
          setIsDirty(false);
          toast(t($ => $.entry.changesStaged), "success");
        },
        onError: (err) => toast(err.message, "error"),
      },
    );
  };

  const handleSave = useCallback(() => saveRef.current(), []);

  const handleDelete = () => {
    deleteMutation.mutate(entryId, {
      onSuccess: () => {
        toast(t($ => $.collection.deleteStaged), "success");
        void navigate({
          to: "/collections/$collection",
          params: { collection },
        });
      },
      onError: (err) => toast(err.message, "error"),
    });
    setShowDeleteConfirm(false);
  };

  // Keyboard shortcut: Cmd/Ctrl+S to save
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
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }

  if (error) {
    return <ErrorBanner>{t($ => $.entry.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  if (!entry) return null;

  const isContentFormat = !(DATA_FORMATS as readonly string[]).includes(entry.format);

  const loaderBase = collectionMeta[collection]?.loaderBase;
  const contentFilePath = loaderBase
    ? getContentFilePath(loaderBase, entryId, entry.format)
    : undefined;

  return (
    <EntryContextProvider value={contentFilePath ? { contentFilePath } : null}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h1 className="text-xl font-semibold">
            {entryId}
            <span className="ml-2 text-sm font-normal text-gray-400">.{entry.format}</span>
          </h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowRaw(!showRaw)}
            >
              {showRaw ? t($ => $.entry.form) : t($ => $.entry.raw)}
            </Button>
            {isContentFormat && (
              <Button
                variant={showPreview ? "secondary" : "outline"}
                onClick={() => setShowPreview(!showPreview)}
              >
                {t($ => $.entry.preview)}
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !isDirty}
            >
              {saveMutation.isPending ? t($ => $.common.saving) : t($ => $.common.save)}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteMutation.isPending}
            >
              {t($ => $.common.delete)}
            </Button>
          </div>
        </div>

        {/* onChangeCapture catches user interaction with any input/textarea/select */}
        <div
          onChangeCapture={() => setIsDirty(true)}
          className={
            showPreview && isContentFormat
              ? "grid min-h-0 flex-1 grid-cols-2 gap-4"
              : "min-h-0 flex-1 overflow-y-auto"
          }
        >
          <div className={showPreview && isContentFormat ? "min-h-0 overflow-y-auto" : ""}>
            {showRaw ? (
              <div className="space-y-4">
                <div>
                  <Label>{t($ => $.entry.dataJson)}</Label>
                  <Textarea
                    value={rawJson}
                    onChange={(e) => setRawJson(e.target.value)}
                    onBlur={syncRawToForm}
                    className="font-mono"
                    rows={12}
                  />
                </div>
                {isContentFormat && (
                  <div>
                    <Label>{t($ => $.entry.body)}</Label>
                    <Textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="font-mono"
                      rows={16}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <FieldsSection
                  schema={schema}
                  formData={formData}
                  onFieldChange={handleFieldChange}
                />
                {isContentFormat && (
                  <div>
                    <Label>{t($ => $.entry.body)}</Label>
                    {entry.format === "mdx" ? (
                      <BlockEditor value={editBody} onChange={setEditBody} />
                    ) : (
                      <MarkdownEditor value={editBody} onChange={setEditBody} />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {showPreview && isContentFormat && (
            <PreviewPanel body={debouncedBody} format={entry.format} />
          )}
        </div>

        <ConfirmDialog
          open={showDeleteConfirm}
          title={t($ => $.entry.deleteEntry)}
          message={t($ => $.entry.deleteEntryMessage, { id: entryId })}
          confirmLabel={t($ => $.common.delete)}
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />

        <ConfirmDialog
          open={blocker.status === "blocked"}
          title={t($ => $.entry.unsavedChanges)}
          message={t($ => $.entry.unsavedChangesMessage)}
          confirmLabel={t($ => $.common.discard)}
          variant="danger"
          onConfirm={() => blocker.status === "blocked" && blocker.proceed()}
          onCancel={() => blocker.status === "blocked" && blocker.reset()}
        />
      </div>
    </EntryContextProvider>
  );
}

function FieldsSection({
  schema,
  formData,
  onFieldChange,
}: {
  schema?: ZodFieldSchema;
  formData: Record<string, unknown>;
  onFieldChange: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const shape = schema?.shape ?? {};

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{t($ => $.entry.fields)}</h2>
      {Object.entries(shape).map(([key, fieldSchema]) => (
        <FieldRenderer
          key={key}
          schema={fieldSchema}
          value={formData[key]}
          onChange={(v) => onFieldChange(key, v)}
          name={key}
          required={fieldSchema.def.type !== "optional"}
        />
      ))}
      {Object.keys(shape).length === 0 && (
        <p className="text-sm text-gray-400">{t($ => $.entry.noSchema)}</p>
      )}
    </div>
  );
}
