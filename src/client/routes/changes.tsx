import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { changesQuery, useChanges } from "@/client/queries/use-entries";
import { preload } from "@/client/lib/query-client";
import { ChangeList } from "@/client/components/changes/change-list";
import { ErrorBanner } from "@/client/components/error-banner";
import { ListSkeleton } from "@/client/components/list-skeleton";
import { PageHeader } from "@/client/components/page-header";

export const Route = createFileRoute("/changes")({
  loader: () => preload(changesQuery),
  pendingComponent: ListSkeleton,
  component: ChangesPage,
});

// Review screen for the pending changeset: what the assistant (or anyone else)
// has written since the last publish, file by file, with the publish and discard
// decision for the whole set.
function ChangesPage() {
  const { t } = useTranslation();
  const { data, error } = useChanges();

  if (error) {
    return <ErrorBanner>{t(($) => $.changes.failedLoad, { message: error.message })}</ErrorBanner>;
  }

  if (!data) return <ListSkeleton />;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
      <PageHeader title={t(($) => $.changes.title)} />
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <ChangeList changes={data} />
      </div>
    </div>
  );
}
