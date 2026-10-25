import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { getToolName } from "ai";
import { EntryLink } from "@/client/components/changes/entry-link";
import { HighlightedCode } from "@/client/components/highlighted-code";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/client/components/ui/trace";
import { formatJson } from "@/client/lib/format-json";
import { describeToolCall } from "@/client/lib/ai/tool-summary";
import type { CmsToolUIPart } from "@/client/lib/ai/agent";

const STATUS: Partial<Record<CmsToolUIPart["state"], ComponentProps<typeof TraceLine>["status"]>> =
  {
    "input-streaming": "running",
    "input-available": "running",
    "output-error": "error",
    "output-denied": "error",
  };

// Mounted only while the trace is open, so a collapsed call formats nothing as the chat streams.
function ToolPayloads({ part }: { part: CmsToolUIPart }) {
  const { t } = useTranslation();

  return (
    <>
      <HighlightedCode
        title={t(($) => $.ai.toolInput)}
        code={formatJson(part.input ?? {})}
        language="json"
      />
      {part.state === "output-available" && (
        <HighlightedCode
          title={t(($) => $.ai.toolOutput)}
          code={formatJson(part.output)}
          language="json"
        />
      )}
      {part.state === "output-error" && (
        <HighlightedCode
          variant="destructive"
          title={t(($) => $.ai.toolError)}
          code={part.errorText}
          language="text"
        />
      )}
    </>
  );
}

// A call that changes content leads with what it changed, in the CMS's own
// vocabulary, and links to the entry: the conversation is where the user follows
// along, and raw tool JSON is not a change log. The inputs and outputs stay one
// click away.
export function ToolCall({ part }: { part: CmsToolUIPart }) {
  const { t } = useTranslation();
  const summary = describeToolCall(part, t);

  return (
    <TraceCollapsible>
      <div className="flex min-w-0 items-center gap-2">
        <TraceCollapsibleTrigger>
          <TraceLine status={STATUS[part.state]}>
            <TraceIcon>
              <Wrench />
            </TraceIcon>
            <TraceTitle>{summary?.description ?? getToolName(part)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        {summary?.collection && summary.entryId && (
          <EntryLink collection={summary.collection} entryId={summary.entryId} />
        )}
      </div>
      <TraceCollapsibleContent className="space-y-2">
        <ToolPayloads part={part} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
