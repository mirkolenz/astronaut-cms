import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/client/components/ui/button";

/** Jumps to an entry's editor, from a change row or from a tool call in the chat. */
export function EntryLink({ collection, entryId }: { collection: string; entryId: string }) {
  const { t } = useTranslation();

  return (
    <Button asChild variant="link" size="xs" className="shrink-0">
      <Link to="/collections/$collection/$entry" params={{ collection, entry: entryId }}>
        {t(($) => $.changes.openEntry)}
      </Link>
    </Button>
  );
}
