import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReasoningUIPart } from "ai";
import { Brain, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { MessageResponse } from "@/client/components/ai-elements/message";
import { cn } from "@/client/lib/utils";
import type { TFunction } from "i18next";

// Long enough to notice the thought finished, short enough not to shove the
// answer down the page while reading.
const COLLAPSE_DELAY_MS = 1000;

function thinkingLabel(t: TFunction, isStreaming: boolean, duration?: number): string {
  if (isStreaming) return t(($) => $.ai.thinking);

  if (duration === undefined) return t(($) => $.ai.thoughtBriefly);

  return t(($) => $.ai.thoughtFor, { seconds: duration });
}

/** How long the model thought, for a trace that streamed in front of the user. */
function useThinkingDuration(isStreaming: boolean): number | undefined {
  const startedAt = useRef<number | undefined>(undefined);
  const [duration, setDuration] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (isStreaming) {
      startedAt.current ??= Date.now();

      return;
    }

    if (startedAt.current === undefined) return;

    setDuration(Math.round((Date.now() - startedAt.current) / 1000));
    startedAt.current = undefined;
  }, [isStreaming]);

  return duration;
}

/**
 * The model's own reasoning: expanded while it streams, collapsed once it is
 * done, and left closed for a trace already in the transcript. Built from the
 * project's own primitives rather than the registry's `reasoning` element, whose
 * generated source does not typecheck (it spreads the collapsible's props into
 * the markdown renderer) and which pulls in an animation library for one label.
 */
function ReasoningTraceView({ part }: { part: ReasoningUIPart }) {
  const { t } = useTranslation();
  const isStreaming = part.state === "streaming";
  const duration = useThinkingDuration(isStreaming);
  const [open, setOpen] = useState(isStreaming);
  // Only a trace the user watched arrive collapses itself, and only once, so
  // reopening one to read it later does not snap shut again.
  const autoCollapsed = useRef(!isStreaming);

  useEffect(() => {
    if (isStreaming || autoCollapsed.current) return;

    const timer = setTimeout(() => {
      autoCollapsed.current = true;
      setOpen(false);
    }, COLLAPSE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [isStreaming]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="not-prose">
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <Brain className="size-4 shrink-0" />
        <span className={cn(isStreaming && "animate-pulse")}>
          {thinkingLabel(t, isStreaming, duration)}
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">
        <MessageResponse>{part.text}</MessageResponse>
      </CollapsibleContent>
    </Collapsible>
  );
}

// The chat re-renders while tokens stream, so every finished trace above the
// live one would otherwise re-render with it. The comparator has to read values:
// the SDK appends to `part.text` in place, leaving the object identical.
export const ReasoningTrace = memo(
  ReasoningTraceView,
  (prev, next) => prev.part.text === next.part.text && prev.part.state === next.part.state,
);
