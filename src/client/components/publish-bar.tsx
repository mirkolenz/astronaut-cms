import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import config from "virtual:astronaut-cms/config";
import { useChangesStore } from "@/client/stores/changes-store";
import { useAuthStore } from "@/client/stores/auth-store";
import { usePublish } from "@/client/queries/use-entries";
import { ConfirmDialog } from "./confirm-dialog";
import { Button } from "@/client/components/ui/button";

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDiscardConfirm(true)}
            disabled={isPublishing || changes.length === 0}
          >
            {t($ => $.common.discard)}
          </Button>
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={isPublishing || changes.length === 0}
          >
            {isPublishing ? t($ => $.publish.publishing) : t($ => $.publish.publish)}
          </Button>
          {config.storageType !== "local" && (
            <Button
              variant="ghost"
              size="xs"
              onClick={clearToken}
            >
              {t($ => $.common.signOut)}
            </Button>
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
