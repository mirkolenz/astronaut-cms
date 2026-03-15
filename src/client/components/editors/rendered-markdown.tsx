import { memo } from "react";
import { usePreviewRenderer, useMorphedHtml } from "@/client/lib/use-preview-renderer";
import { useEntryContext } from "@/client/lib/entry-context";

interface RenderedMarkdownProps {
  content: string;
}

export const RenderedMarkdown = memo(function RenderedMarkdown({ content }: RenderedMarkdownProps) {
  const ctx = useEntryContext();
  const { html } = usePreviewRenderer(content, ctx?.contentFilePath);
  const ref = useMorphedHtml(html);

  return <div ref={ref} className="prose prose-sm dark:prose-invert max-w-none" />;
});
