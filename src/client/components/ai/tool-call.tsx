import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@client/components/ai-elements/tool";
import { EntryLink } from "@client/components/changes/entry-link";
import { describeToolCall } from "@client/lib/ai/tool-summary";
import type { CmsToolUIPart } from "@client/lib/ai/agent";

interface ToolCallProps {
  part: CmsToolUIPart;
}

// Renders a single tool call from the generated ai-elements primitives. A call
// that changes content leads with what it changed, in the CMS's own vocabulary,
// and links to the entry: the conversation is where the user follows along, and
// raw tool JSON is not a change log. The inputs and outputs stay one click away.
// Kept out of components/ai-elements so the generated files stay untouched.
export function ToolCall({ part }: ToolCallProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const summary = describeToolCall(part, t);

  return (
    <Tool open={open} onOpenChange={setOpen}>
      <ToolHeader type={part.type} state={part.state} />
      {summary && (
        <div className="flex items-center gap-2 px-4 pb-2 text-sm">
          <span className="truncate">{summary.description}</span>
          {summary.collection && summary.entryId && (
            <EntryLink collection={summary.collection} entryId={summary.entryId} />
          )}
        </div>
      )}
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}
