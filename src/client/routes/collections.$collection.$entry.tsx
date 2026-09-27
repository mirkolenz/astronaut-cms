import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useEntry, useSaveEntry, useDeleteEntry } from "@client/queries/use-entries";
import { useCollections } from "@client/queries/use-collections";
import { FieldRenderer, type ZodFieldSchema } from "@client/components/editors/field-renderer";
import { MdxEditor } from "@client/components/editors/mdx-editor";
import { ConfirmDialog } from "@client/components/confirm-dialog";
import { toast } from "@client/components/toast";
import { ErrorBanner } from "@client/components/error-banner";
import { DATA_FORMATS } from "@shared/types";
import { EntryContextProvider } from "@client/lib/entry-context";
import { getContentFilePath } from "@client/lib/asset-utils";
import { ChevronRight } from "lucide-react";
import { Button } from "@client/components/ui/button";
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
  const shape: Record<string, ZodFieldSchema> | undefined = schema?.shape;
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [editBody, setEditBody] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData(entry.data);
      setEditBody(entry.body);
      setIsDirty(false);
    }
  }, [entry]);

  // Block in-app navigation and browser close/refresh when dirty
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Use ref for save to avoid event listener churn
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => {
    if (!entry) return;
    saveMutation.mutate(
      { data: formData, body: editBody, format: entry.format },
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

  const [editorKey, setEditorKey] = useState(0);

  const handleCancel = useCallback(() => {
    if (!entry) return;
    setFormData(entry.data);
    setEditBody(entry.body);
    setIsDirty(false);
    setEditorKey((k) => k + 1);
  }, [entry]);

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

  const handleBodyChange = useCallback((value: string) => {
    setEditBody(value);
    setIsDirty(true);
  }, []);

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
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
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
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h1 className="text-xl font-semibold">
            {entryId}
            <span className="ml-2 text-sm font-normal text-muted-foreground">.{entry.format}</span>
          </h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={!isDirty}
            >
              {t($ => $.common.cancel)}
            </Button>
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
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="space-y-4">
            {shape && (
              <CollapsibleSection title={t($ => $.entry.fields)}>
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
                </div>
              </CollapsibleSection>
            )}
            {isContentFormat && (
              <CollapsibleSection title={t($ => $.entry.body)} defaultOpen>
                <MdxEditor
                  key={editorKey}
                  markdown={editBody}
                  onChange={handleBodyChange}
                  format={entry.format as "md" | "mdx"}
                />
              </CollapsibleSection>
            )}
          </div>
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

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase select-none"
      >
        <ChevronRight
          className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {title}
      </button>
      {open && <div className="pt-2">{children}</div>}
    </div>
  );
}

