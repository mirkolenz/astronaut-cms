import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useChanges } from "@client/queries/use-entries";
import { ChangeList } from "@client/components/changes/change-list";
import { ErrorBanner } from "@client/components/error-banner";
import { Spinner } from "@client/components/ui/spinner";

export const Route = createFileRoute("/changes")({
  component: ChangesPage,
});

// Review screen for the pending changeset: what the assistant (or anyone else)
// has written since the last publish, file by file, with the publish and discard
// decision for the whole set.
function ChangesPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useChanges();

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      <h1 className="text-xl font-semibold">{t(($) => $.changes.title)}</h1>

      {error && <ErrorBanner>{error.message}</ErrorBanner>}
      {isLoading && <Spinner />}
      {data && (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ChangeList changes={data} />
        </div>
      )}
    </div>
  );
}
