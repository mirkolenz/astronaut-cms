import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  CircleCheck,
  FilePlus2,
  FilePen,
  FileX2,
  FileSymlink,
} from "lucide-react";
import type { ChangeKind, FileChange } from "@/shared/types";
import { describeChange } from "@/client/lib/changes";
import { CodeBlock } from "@/client/components/ai-elements/code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { Badge } from "@/client/components/ui/badge";
import { markReviewed, useIsReviewed, useReviewedCount } from "@/client/stores/review-store";
import { EntryLink } from "./entry-link";
import type en from "@/client/i18n/locales/en";

interface KindPresentation {
  icon: typeof FilePen;
  variant: "default" | "secondary" | "destructive" | "outline";
  label: (messages: typeof en) => string;
}

// How each kind of change presents itself. One table, so a new kind is one entry
// rather than three parallel edits.
const KIND: Record<ChangeKind, KindPresentation> = {
  added: { icon: FilePlus2, variant: "default", label: ($) => $.changes.added },
  modified: { icon: FilePen, variant: "secondary", label: ($) => $.changes.modified },
  deleted: { icon: FileX2, variant: "destructive", label: ($) => $.changes.deleted },
  renamed: { icon: FileSymlink, variant: "outline", label: ($) => $.changes.renamed },
};

function ChangeRow({ change }: { change: FileChange }) {
  const { t } = useTranslation();
  const described = describeChange(change);
  const { icon: Icon, variant, label } = KIND[described.kind];
  const reviewed = useIsReviewed(change);
  const [open, setOpen] = useState(false);

  // Whatever is on screen while open counts as seen, including a diff that was
  // refreshed underneath an open row.
  useEffect(() => {
    if (open) markReviewed(change);
  }, [open, change]);

  return (
    <Collapsible className="rounded-md border border-border" open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{described.label}</span>
          {described.previousPath && (
            <span className="truncate text-xs text-muted-foreground">
              ← {described.previousPath}
            </span>
          )}
        </CollapsibleTrigger>
        {reviewed && (
          <CircleCheck
            className="size-4 shrink-0 text-muted-foreground"
            aria-label={t(($) => $.changes.reviewed)}
          />
        )}
        <Badge variant={variant}>{t(label)}</Badge>
        {/* A deleted entry has nowhere to navigate to. */}
        {described.collection && described.entryId && described.kind !== "deleted" && (
          <EntryLink collection={described.collection} entryId={described.entryId} />
        )}
      </div>
      <CollapsibleContent className="px-3 pb-3">
        {described.patch ? (
          <CodeBlock code={described.patch} language="diff" />
        ) : (
          <p className="text-xs text-muted-foreground">{t(($) => $.changes.noDiff)}</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The pending changeset as a reviewable list: one collapsible diff per file.
 * Opening a diff marks it reviewed, which is what unlocks publishing.
 */
export function ChangeList({ changes }: { changes: FileChange[] }) {
  const { t } = useTranslation();
  const reviewed = useReviewedCount(changes);

  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(($) => $.changes.empty)}</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t(($) => $.changes.reviewProgress, { reviewed, count: changes.length })}
      </p>
      {changes.map((change) => (
        <ChangeRow key={`${change.kind}:${change.path}`} change={change} />
      ))}
    </div>
  );
}
