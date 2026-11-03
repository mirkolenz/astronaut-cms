import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import config from "@/client/lib/config";
import {
  useBranchStatus,
  useChanges,
  usePublish,
  useUpdate,
  useDiscard,
} from "@/client/queries/use-entries";
import { isStaleWrite } from "@/client/lib/api";
import { useRunMutation } from "@/client/hooks/use-run-mutation";
import { buildPreviewUrl } from "@/client/lib/preview-url";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/components/toast";
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
  const run = useRunMutation();
  const [confirming, setConfirming] = useState<"publish" | "discard" | null>(null);
  const [digesting, setDigesting] = useState(false);

  const { publish: canPublish, update: canUpdate } = config.capabilities;
  const count = changes.data?.length ?? 0;
  const reviewed = useReviewedCount(changes.data ?? []);
  const behind = status.data?.behind ?? 0;
  const branch = status.data?.branch;
  const previewUrl =
    branch && config.previewUrl ? buildPreviewUrl(config.previewUrl, branch) : null;
  const busy = publish.isPending || update.isPending || discard.isPending || changes.isFetching;

  // Only what this tab has shown is published: the digest pins the changeset to
  // the reviewed snapshot, and the server refuses it once the branch moved on.
  const confirmPublish = async (): Promise<void> => {
    if (!changes.data || reviewed < count) {
      setConfirming(null);
      toast(
        t(($) => $.publish.stale),
        "error",
      );

      return;
    }

    // Pending from the first click, since hashing the changeset takes a moment before the mutation starts.
    setDigesting(true);
    const digest = await changesetDigest(changes.data).finally(() => setDigesting(false));

    run(publish, digest, {
      success: t(($) => $.publish.published),
      onSuccess: () => {
        setConfirming(null);
        clearReviews();
      },
      // Stale here means the changeset moved on since it was reviewed.
      describeError: (err) => (isStaleWrite(err) ? t(($) => $.publish.stale) : undefined),
    });
  };

  return (
    <div className="flex items-center gap-2">
      {canUpdate && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => run(update, undefined, { success: t(($) => $.publish.updated) })}
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
          <Button size="sm" onClick={() => setConfirming("publish")} disabled={busy || count === 0}>
            {publish.isPending ? t(($) => $.publish.publishing) : t(($) => $.publish.publish)}
          </Button>
        ))}

      <ConfirmDialog
        open={confirming === "publish"}
        title={t(($) => $.publish.confirmTitle)}
        description={t(($) => $.publish.confirmMessage)}
        confirmLabel={t(($) => $.publish.confirm)}
        pendingLabel={t(($) => $.publish.publishing)}
        isPending={digesting || publish.isPending}
        onConfirm={() => void confirmPublish()}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === "discard"}
        title={t(($) => $.changes.discardAll)}
        description={
          <>
            <p>{t(($) => $.changes.discardAllMessage, { count })}</p>
            {config.storageType === "local" && (
              <p className="mt-2">{t(($) => $.changes.discardAllLocal)}</p>
            )}
            <ul className="mt-2 max-h-48 overflow-y-auto font-mono text-xs">
              {changes.data?.map((change) => (
                <li key={change.path} className="truncate">
                  {change.path}
                </li>
              ))}
            </ul>
          </>
        }
        confirmLabel={t(($) => $.common.discard)}
        pendingLabel={t(($) => $.publish.discarding)}
        isPending={discard.isPending}
        variant="destructive"
        onConfirm={() =>
          run(discard, undefined, {
            success: t(($) => $.changes.discarded),
            onSuccess: () => {
              setConfirming(null);
              clearReviews();
            },
          })
        }
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
