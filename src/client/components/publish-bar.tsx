import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import config from "virtual:astronaut-cms/config";
import { useChangesStore } from "@/client/stores/changes-store";
import { useAuthStore } from "@/client/stores/auth-store";
import { usePublish } from "@/client/queries/use-entries";
import { ConfirmDialog } from "./confirm-dialog";

export function PublishBar() {
  const { t } = useTranslation();
  const { changes, isPublishing, publishError, clearChanges } = useChangesStore();
  const clearToken = useAuthStore((s) => s.clearToken);
  const publishMutation = usePublish();
  const queryClient = useQueryClient();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  if (changes.length === 0 && !publishError) return null;

  const handlePublish = () => {
    publishMutation.mutate();
  };

  const handleDiscard = () => {
    clearChanges();
    void queryClient.invalidateQueries({ queryKey: ["cms"] });
    setShowDiscardConfirm(false);
  };

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">
            {t($ => $.publish.pendingChanges, { count: changes.length })}
          </span>
          {publishError && (
            <span className="text-xs text-red-600 dark:text-red-400">{publishError}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDiscardConfirm(true)}
            disabled={isPublishing || changes.length === 0}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t($ => $.common.discard)}
          </button>
          <button
            onClick={handlePublish}
            disabled={isPublishing || changes.length === 0}
            className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {isPublishing ? t($ => $.publish.publishing) : t($ => $.publish.publish)}
          </button>
          {config.storageType !== "local" && (
            <button
              onClick={clearToken}
              className="rounded-md px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              {t($ => $.common.signOut)}
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title={t($ => $.publish.discardChanges)}
        message={t($ => $.publish.discardChangesMessage, { count: changes.length })}
        confirmLabel={t($ => $.common.discard)}
        variant="danger"
        onConfirm={handleDiscard}
        onCancel={() => setShowDiscardConfirm(false)}
      />
      {changes.length > 0 && (
        <div className="mt-2 space-y-1">
          {changes.map((change) => (
            <div key={change.id} className="flex items-center gap-2 text-xs text-gray-500">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  change.action === "delete"
                    ? "bg-red-500"
                    : change.action === "create"
                      ? "bg-green-500"
                      : "bg-yellow-500"
                }`}
              />
              <span>{change.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
