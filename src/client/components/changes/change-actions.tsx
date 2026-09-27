import { useState } from "react";
import { useTranslation } from "react-i18next";
import config from "virtual:astronaut-cms/config";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  useBranchStatus,
  useChanges,
  usePublish,
  useUpdate,
  useDiscard,
} from "@client/queries/use-entries";
import { getStorage } from "@client/lib/storage";
import { MergeConflictError } from "@client/lib/storage/types";
import { buildPreviewUrl } from "@client/lib/preview-url";
import { ConfirmDialog } from "@client/components/confirm-dialog";
import { Button } from "@client/components/ui/button";
import { toast } from "@client/components/toast";

/**
 * Publish, update and discard for the changeset as a whole. Nothing here acts on
 * a single change: the changeset is the unit the user decides about, which is
 * what lets the assistant write freely without asking permission per tool call.
 */
export function ChangeActions() {
  const { t } = useTranslation();
  const status = useBranchStatus();
  const changes = useChanges();
  const publish = usePublish();
  const update = useUpdate();
  const discard = useDiscard();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const { publish: canPublish, update: canUpdate } = getStorage().capabilities;
  const count = changes.data?.length ?? 0;
  const behind = status.data?.behind ?? 0;
  const branch = status.data?.branch;
  const previewUrl =
    branch && config.previewUrl ? buildPreviewUrl(config.previewUrl, branch) : null;
  const busy = publish.isPending || update.isPending || discard.isPending || changes.isFetching;

  const reportError = (err: unknown) => {
    toast(
      err instanceof MergeConflictError
        ? t(($) => $.publish.mergeConflict)
        : err instanceof Error
          ? err.message
          : String(err),
      "error",
    );
  };

  const run = (mutation: UseMutationResult<void, Error, void>, message: string): void => {
    mutation.mutate(undefined, {
      onSuccess: () => toast(message, "success"),
      onError: reportError,
    });
  };

  return (
    <div className="flex items-center gap-2">
      {canUpdate && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => run(update, t(($) => $.publish.updated))}
          disabled={busy || behind === 0}
        >
          {update.isPending ? t(($) => $.publish.updating) : t(($) => $.publish.update)}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowDiscardConfirm(true)}
        disabled={busy || count === 0}
      >
        {discard.isPending ? t(($) => $.publish.discarding) : t(($) => $.changes.discardAll)}
      </Button>
      {previewUrl && (
        <Button variant="outline" size="sm" asChild>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer">
            {t(($) => $.publish.preview)}
          </a>
        </Button>
      )}
      {canPublish && (
        <Button
          size="sm"
          onClick={() => run(publish, t(($) => $.publish.published))}
          disabled={busy || count === 0}
        >
          {publish.isPending ? t(($) => $.publish.publishing) : t(($) => $.publish.publish)}
        </Button>
      )}

      <ConfirmDialog
        open={showDiscardConfirm}
        title={t(($) => $.changes.discardAll)}
        message={t(($) => $.changes.discardAllMessage, { count })}
        confirmLabel={t(($) => $.common.discard)}
        variant="danger"
        onConfirm={() => {
          setShowDiscardConfirm(false);
          run(discard, t(($) => $.changes.discarded));
        }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </div>
  );
}
