import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import config from "virtual:astronaut-cms/config";
import { useAuthStore } from "@client/stores/auth-store";
import { revokeSession } from "@client/lib/oauth/session";
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
  const session = useAuthStore((s) => s.session);
  const clearSession = useAuthStore((s) => s.clearSession);
  const status = useBranchStatus();
  const changes = useChanges();

  const count = changes.data?.length ?? 0;
  const changeRequestUrl = status.data?.changeRequestUrl;
  const changeRequestLabel =
    config.storageType === "gitlab"
      ? t(($) => $.publish.viewMergeRequest)
      : t(($) => $.publish.viewPullRequest);

  const handleSignOut = () => {
    const current = session;
    clearSession();
    if (current) void revokeSession(current).catch(() => {});
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
          {session && (
            <Button variant="ghost" size="xs" onClick={handleSignOut}>
              {t(($) => $.common.signOut)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
