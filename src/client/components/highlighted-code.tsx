import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/client/components/ui/code-block";
import { useHighlightedCode } from "@/client/hooks/use-highlighted-code";

// Languages the generated highlighter leaves out, read with the closest one it has.
const FALLBACKS: Record<string, string> = { mdx: "markdown" };

interface HighlightedCodeProps extends Pick<
  ComponentProps<typeof CodeBlock>,
  "variant" | "className"
> {
  code: string;
  language: string;
  title?: ReactNode;
  copyable?: boolean;
}

/** Code highlighted by the shared Shiki core, under a header with its title and a copy button. */
export function HighlightedCode({
  code,
  language,
  title,
  copyable = false,
  variant,
  className,
}: HighlightedCodeProps) {
  const { t } = useTranslation();
  const lines = useHighlightedCode(code, FALLBACKS[language.toLowerCase()] ?? language);

  return (
    <CodeBlock size="sm" variant={variant} className={className}>
      {(title || copyable) && (
        <CodeBlockHeader>
          {title && <CodeBlockTitle>{title}</CodeBlockTitle>}
          {copyable && (
            <CodeBlockActions>
              <CodeBlockCopyButton value={code} aria-label={t(($) => $.common.copyCode)} />
            </CodeBlockActions>
          )}
        </CodeBlockHeader>
      )}
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}
