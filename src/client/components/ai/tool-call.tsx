import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@client/components/ui/button";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@client/components/ai-elements/tool";
import type { CmsToolUIPart } from "@client/lib/ai/agent";

interface ToolCallProps {
  part: CmsToolUIPart;
  onApprovalResponse: (response: { id: string; approved: boolean }) => void;
}

// Renders a single tool call from the generated ai-elements primitives, adding
// the inline approve/deny controls for the tools listed in `cmsToolApproval`.
// Kept out of components/ai-elements so the generated files stay untouched.
export function ToolCall({ part, onApprovalResponse }: ToolCallProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const awaitingApproval = part.state === "approval-requested";

  // Reveal the call when it needs approval so the controls are visible without
  // an extra click; the user can still collapse it again afterwards.
  useEffect(() => {
    if (awaitingApproval) setOpen(true);
  }, [awaitingApproval]);

  return (
    <Tool open={open} onOpenChange={setOpen}>
      <ToolHeader type={part.type} state={part.state} />
      <ToolContent>
        <ToolInput input={part.input} />

        {awaitingApproval && (
          <div className="space-y-3 rounded-md border border-yellow-600/30 bg-yellow-600/10 p-3">
            <p className="text-sm">{t(($) => $.ai.approvalPrompt)}</p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onApprovalResponse({ id: part.approval.id, approved: false })}
              >
                {t(($) => $.ai.deny)}
              </Button>
              <Button
                size="sm"
                onClick={() => onApprovalResponse({ id: part.approval.id, approved: true })}
              >
                {t(($) => $.ai.approve)}
              </Button>
            </div>
          </div>
        )}

        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}
