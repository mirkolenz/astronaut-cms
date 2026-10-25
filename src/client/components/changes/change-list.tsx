import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CircleCheck,
  FilePlus2,
  FilePen,
  FileX2,
  FileSymlink,
  GitCompareArrows,
} from "lucide-react";
import type { ChangeKind, FileChange } from "@/shared/types";
import { describeChange } from "@/client/lib/changes";
import { ItemActions, ItemDescription, ItemGroup, ItemTitle } from "@/client/components/ui/item";
import { HighlightedCode } from "@/client/components/highlighted-code";
import { CollapsibleItem } from "@/client/components/collapsible-item";
import { CollapsibleContent } from "@/client/components/ui/collapsible";
import { Badge } from "@/client/components/ui/badge";
import { markReviewed, useIsReviewed, useReviewedCount } from "@/client/stores/review-store";
import { EntryLink } from "@/client/components/changes/entry-link";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/client/components/ui/empty";
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
    <CollapsibleItem
      open={open}
      onOpenChange={setOpen}
      role="listitem"
      icon={<Icon />}
      label={
        <>
          <ItemTitle>{described.label}</ItemTitle>
          {described.previousPath && (
            <ItemDescription className="flex items-center gap-1">
              <ArrowLeft className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{described.previousPath}</span>
            </ItemDescription>
          )}
        </>
      }
    >
      <ItemActions>
        {reviewed && (
          <CircleCheck
            className="size-4 text-muted-foreground"
            aria-label={t(($) => $.changes.reviewed)}
          />
        )}
        <Badge variant={variant}>{t(label)}</Badge>
        {/* A deleted entry has nowhere to navigate to. */}
        {described.collection && described.entryId && described.kind !== "deleted" && (
          <EntryLink collection={described.collection} entryId={described.entryId} />
        )}
      </ItemActions>
      <CollapsibleContent className="basis-full">
        {described.patch ? (
          <HighlightedCode code={described.patch} language="diff" />
        ) : (
          <p className="text-xs text-muted-foreground">{t(($) => $.changes.noDiff)}</p>
        )}
      </CollapsibleContent>
    </CollapsibleItem>
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
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitCompareArrows />
          </EmptyMedia>
          <EmptyTitle>{t(($) => $.changes.none)}</EmptyTitle>
          <EmptyDescription>{t(($) => $.changes.empty)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t(($) => $.changes.reviewProgress, { reviewed, count: changes.length })}
      </p>
      <ItemGroup>
        {changes.map((change) => (
          <ChangeRow key={`${change.kind}:${change.path}`} change={change} />
        ))}
      </ItemGroup>
    </div>
  );
}
