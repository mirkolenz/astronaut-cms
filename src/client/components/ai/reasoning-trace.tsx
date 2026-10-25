import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReasoningUIPart } from "ai";
import { Brain } from "lucide-react";
import { Markdown } from "@/client/components/ai/markdown";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/client/components/ui/trace";
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
 * done, and left closed for a trace already in the transcript.
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
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={isStreaming ? "running" : undefined}>
          <TraceIcon>
            <Brain />
          </TraceIcon>
          <TraceTitle>{thinkingLabel(t, isStreaming, duration)}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>

      <TraceCollapsibleContent>
        <Markdown streaming={isStreaming}>{part.text}</Markdown>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

// The chat re-renders while tokens stream, so every finished trace above the
// live one would otherwise re-render with it. The comparator has to read values:
// the SDK appends to `part.text` in place, leaving the object identical.
export const ReasoningTrace = memo(
  ReasoningTraceView,
  (prev, next) => prev.part.text === next.part.text && prev.part.state === next.part.state,
);
