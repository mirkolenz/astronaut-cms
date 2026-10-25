import type { ComponentProps } from "react";
import {
  defaultComponents,
  Streamdown,
  useIsCodeFenceIncomplete,
  type ExtraProps,
} from "streamdown";
import { HighlightedCode } from "@/client/components/highlighted-code";

function FencedCode({ code, language }: { code: string; language: string }) {
  // The copy button waits for the closing fence, so it never copies half the code.
  const incomplete = useIsCodeFenceIncomplete();

  return (
    <HighlightedCode
      code={code}
      language={language}
      title={language || "text"}
      copyable={!incomplete}
      className="my-4"
    />
  );
}

/** Fenced code, which Streamdown marks with `data-block`, as a code block. Inline code keeps its own rendering. */
function MarkdownCode(props: ComponentProps<"code"> & ExtraProps) {
  if (!("data-block" in props)) return <defaultComponents.code {...props} />;

  const language = /language-(\S+)/.exec(props.className ?? "")?.[1] ?? "";

  return (
    <FencedCode
      code={typeof props.children === "string" ? props.children : ""}
      language={language}
    />
  );
}

const COMPONENTS = { code: MarkdownCode };

/** The model's markdown, rendered as it streams in. Streamdown memoizes itself. */
export function Markdown({ children, streaming }: { children: string; streaming: boolean }) {
  return (
    <Streamdown
      isAnimating={streaming}
      className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      components={COMPONENTS}
    >
      {children}
    </Streamdown>
  );
}
