import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import config from "@client/lib/config";
import { signOut } from "@client/lib/api";
import { useBranchStatus, useChanges } from "@client/queries/use-entries";
import { ChangeActions } from "@client/components/changes/change-actions";
import { Button } from "@client/components/ui/button";

/**
 * Standing summary of the pending changeset, with the actions that resolve it.
 * It is shown for every backend, including local storage: writes go straight to
 * the working tree there, but git still knows what changed, so the same review
 * and discard flow applies.
 */
export function PublishBar() {
  const { t } = useTranslation();
  const status = useBranchStatus();
  const changes = useChanges();

  const count = changes.data?.length ?? 0;
  const changeRequestUrl = status.data?.changeRequestUrl;
  const changeRequestLabel =
    config.storageType === "gitlab"
      ? t(($) => $.publish.viewMergeRequest)
      : t(($) => $.publish.viewPullRequest);

  // The cookie is the session, so ending it is the server's to do. Reloading
  // afterwards is the point rather than a nicety: the admin holds fetched
  // repository content in memory and in the query cache, and on a shared machine
  // none of it may outlive the click. The reload re-renders the page anonymous,
  // which is the sign-in screen.
  const handleSignOut = () => {
    void signOut().finally(() => window.location.reload());
  };

  return (
    <div className="border-t border-border bg-muted px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          {count === 0 ? (
            <span className="text-muted-foreground">{t(($) => $.changes.none)}</span>
          ) : (
            <Link to="/changes" className="font-medium underline-offset-4 hover:underline">
              {t(($) => $.changes.pending, { count })}
            </Link>
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
          <ChangeActions />
          {config.storageType !== "local" && (
            <Button variant="ghost" size="xs" onClick={handleSignOut}>
              {t(($) => $.common.signOut)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
