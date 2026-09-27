import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import config from "@/client/lib/config";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  useBranchStatus,
  useChanges,
  usePublish,
  useUpdate,
  useDiscard,
} from "@/client/queries/use-entries";
import { isMergeConflict, isStaleWrite } from "@/client/lib/api";
import { buildPreviewUrl } from "@/client/lib/preview-url";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/components/toast";
import { errorMessage } from "@/shared/errors";
import { changesetDigest } from "@/shared/digest";
import { clearReviews, useReviewedCount } from "@/client/stores/review-store";

/**
 * Publish, update and discard for the changeset as a whole. Nothing here acts on
 * a single change: the changeset is the unit the user decides about, which is
 * what lets the assistant write freely without asking permission per tool call.
 *
 * Publishing requires every change to have been opened on the Changes screen
 * and an explicit acceptance of editorial responsibility.
 */
export function ChangeActions() {
  const { t } = useTranslation();
  const status = useBranchStatus();
  const changes = useChanges();
  const publish = usePublish();
  const update = useUpdate();
  const discard = useDiscard();
  const [confirming, setConfirming] = useState<"publish" | "discard" | null>(null);

  const { publish: canPublish, update: canUpdate } = config.capabilities;
  const count = changes.data?.length ?? 0;
  const reviewed = useReviewedCount(changes.data ?? []);
  const behind = status.data?.behind ?? 0;
  const branch = status.data?.branch;
  const previewUrl =
    branch && config.previewUrl ? buildPreviewUrl(config.previewUrl, branch) : null;
  const busy = publish.isPending || update.isPending || discard.isPending || changes.isFetching;

  const reportError = (err: unknown) => {
    toast(
      isMergeConflict(err)
        ? t(($) => $.publish.mergeConflict)
        : isStaleWrite(err)
          ? t(($) => $.publish.stale)
          : errorMessage(err),
      "error",
    );
  };

  const run = <T,>(
    mutation: UseMutationResult<unknown, Error, T>,
    variables: T,
    message: string,
    onSuccess?: () => void,
  ): void => {
    mutation.mutate(variables, {
      onSuccess: () => {
        onSuccess?.();
        toast(message, "success");
      },
      onError: reportError,
    });
  };

  // Only what this tab has shown is published: the digest pins the changeset to
  // the reviewed snapshot, and the server refuses it once the branch moved on.
  const confirmPublish = async (): Promise<void> => {
    setConfirming(null);

    if (!changes.data || reviewed < count) {
      toast(t(($) => $.publish.stale), "error");

      return;
    }

    run(publish, await changesetDigest(changes.data), t(($) => $.publish.published), clearReviews);
  };

  return (
    <div className="flex items-center gap-2">
      {canUpdate && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            run(
              update,
              undefined,
              t(($) => $.publish.updated),
            )
          }
          disabled={busy || behind === 0}
        >
          {update.isPending ? t(($) => $.publish.updating) : t(($) => $.publish.update)}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirming("discard")}
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
      {canPublish &&
        (reviewed < count ? (
          <Button size="sm" asChild>
            <Link to="/changes">{t(($) => $.publish.review)}</Link>
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => setConfirming("publish")}
            disabled={busy || count === 0}
          >
            {publish.isPending ? t(($) => $.publish.publishing) : t(($) => $.publish.publish)}
          </Button>
        ))}

      <ConfirmDialog
        open={confirming === "publish"}
        title={t(($) => $.publish.confirmTitle)}
        message={t(($) => $.publish.confirmMessage)}
        confirmLabel={t(($) => $.publish.confirm)}
        onConfirm={() => void confirmPublish()}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === "discard"}
        title={t(($) => $.changes.discardAll)}
        message={t(($) => $.changes.discardAllMessage)}
        confirmLabel={t(($) => $.common.discard)}
        variant="danger"
        onConfirm={() => {
          setConfirming(null);
          run(discard, undefined, t(($) => $.changes.discarded), clearReviews);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
