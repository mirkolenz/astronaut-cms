import { useState } from "react";
import { useTranslation } from "react-i18next";
import config from "virtual:astronaut-cms/config";
import { useAuthStore } from "@client/stores/auth-store";
import { revokeSession } from "@client/lib/oauth/session";
import {
  useBranchStatus,
  usePublish,
  useUpdate,
  useDiscard,
} from "@client/queries/use-entries";
import { MergeConflictError } from "@client/lib/storage/types";
import { buildPreviewUrl } from "@client/lib/preview-url";
import { ConfirmDialog } from "./confirm-dialog";
import { Button } from "@client/components/ui/button";
import { toast } from "@client/components/toast";

export function PublishBar() {
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const clearSession = useAuthStore((s) => s.clearSession);
  const status = useBranchStatus();
  const publish = usePublish();
  const update = useUpdate();
  const discard = useDiscard();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  if (config.storageType === "local") return null;

  const data = status.data;
  const ahead = data?.ahead ?? 0;
  const behind = data?.behind ?? 0;
  const hasBranch = data?.hasBranch ?? false;
  const changeRequestUrl = data?.changeRequestUrl;
  const changeRequestLabel =
    config.storageType === "gitlab"
      ? t($ => $.publish.viewMergeRequest)
      : t($ => $.publish.viewPullRequest);
  const previewUrl =
    hasBranch && data?.branch && config.previewUrl
      ? buildPreviewUrl(config.previewUrl, data.branch)
      : null;
  const busy =
    publish.isPending || update.isPending || discard.isPending || status.isFetching;

  const reportError = (err: unknown) => {
    if (err instanceof MergeConflictError) {
      toast(t($ => $.publish.mergeConflict), "error");
    } else {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handlePublish = () => {
    publish.mutate(undefined, {
      onSuccess: () => toast(t($ => $.publish.published), "success"),
      onError: reportError,
    });
  };

  const handleUpdate = () => {
    update.mutate(undefined, {
      onSuccess: () => toast(t($ => $.publish.updated), "success"),
      onError: reportError,
    });
  };

  const handleDiscard = () => {
    setShowDiscardConfirm(false);
    discard.mutate(undefined, {
      onSuccess: () => toast(t($ => $.publish.discarded), "success"),
      onError: reportError,
    });
  };

  const handleSignOut = () => {
    const current = session;
    clearSession();
    if (current) void revokeSession(current).catch(() => {});
  };

  return (
    <div className="border-t border-border bg-muted px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          {!hasBranch && (
            <span className="text-muted-foreground">{t($ => $.publish.upToDate)}</span>
          )}
          {hasBranch && (
            <span className="font-medium">
              {t($ => $.publish.aheadBehind, { ahead, behind })}
            </span>
          )}
          {changeRequestUrl && (
            <a
              href={changeRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-primary underline hover:text-primary/80"
            >
              {changeRequestLabel}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleUpdate}
            disabled={busy || !hasBranch || behind === 0}
          >
            {update.isPending ? t($ => $.publish.updating) : t($ => $.publish.update)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDiscardConfirm(true)}
            disabled={busy || !hasBranch}
          >
            {discard.isPending ? t($ => $.publish.discarding) : t($ => $.common.discard)}
          </Button>
          {previewUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                {t($ => $.publish.preview)}
              </a>
            </Button>
          )}
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={busy || !hasBranch || ahead === 0}
          >
            {publish.isPending ? t($ => $.publish.publishing) : t($ => $.publish.publish)}
          </Button>
          <Button variant="ghost" size="xs" onClick={handleSignOut}>
            {t($ => $.common.signOut)}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title={t($ => $.publish.discardChanges)}
        message={t($ => $.publish.discardChangesMessage, { ahead })}
        confirmLabel={t($ => $.common.discard)}
        variant="danger"
        onConfirm={handleDiscard}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </div>
  );
}
