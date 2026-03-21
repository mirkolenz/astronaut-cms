import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePreviewRenderer, useMorphedHtml } from "@/client/lib/use-preview-renderer";
import { useEntryContext } from "@/client/lib/entry-context";
import {
  parseMdxToBlocks,
  getMarkdownContent,
  getSignificantChildren,
  inferChildrenMode,
  type Block,
  type ComponentBlock,
} from "@/client/lib/block-model";
import { components } from "virtual:astronaut-cms/user-config";
import { findComponent } from "@/client/lib/component-lookup";
import { RenderedMarkdown } from "@/client/components/editors/rendered-markdown";

interface PreviewPanelProps {
  body: string;
  format?: string;
}

export const PreviewPanel = memo(function PreviewPanel({ body, format }: PreviewPanelProps) {
  if (format === "mdx") {
    return <MdxPreview body={body} />;
  }
  return <MarkdownPreview body={body} />;
});

function MarkdownPreview({ body }: { body: string }) {
  const { t } = useTranslation();
  const ctx = useEntryContext();
  const { html, isRendering, error } = usePreviewRenderer(body, ctx?.contentFilePath);
  const previewRef = useMorphedHtml(html);

  return (
    <PreviewShell isRendering={isRendering}>
      {error && (
        <div className="p-4 text-sm text-red-600 dark:text-red-400">{t($ => $.editors.renderError, { error })}</div>
      )}
      <div ref={previewRef} className="prose prose-sm dark:prose-invert max-w-none p-4" />
    </PreviewShell>
  );
}

function MdxPreview({ body }: { body: string }) {
  const { t } = useTranslation();
  const blocks = useMemo(() => parseMdxToBlocks(body), [body]);

  return (
    <PreviewShell>
      <div className="space-y-4 p-4">
        {blocks.map((block, index) => (
          <BlockPreview key={index} block={block} />
        ))}
        {blocks.length === 0 && <p className="text-sm text-gray-400">{t($ => $.editors.noContentToPreview)}</p>}
      </div>
    </PreviewShell>
  );
}

function PreviewShell({
  children,
  isRendering,
}: {
  children: React.ReactNode;
  isRendering?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
        <span className="text-xs font-medium text-gray-500">{t($ => $.entry.preview)}</span>
        {isRendering && <div className="h-0.5 w-12 animate-pulse rounded bg-blue-400" />}
      </div>
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-950">{children}</div>
    </div>
  );
}

// ── MDX block preview renderers ──────────────────────────────────────

function BlockPreview({ block }: { block: Block }) {
  if (block.type === "text") {
    return <RenderedMarkdown content={block.content} />;
  }
  return <ComponentPreview block={block} />;
}

function ComponentPreview({ block }: { block: ComponentBlock }) {
  const def = findComponent(block.name, components);
  const label = def?.label ?? block.name;
  const icon = def?.icon;
  const Wrapper = def?.wrapper;
  const childrenConfig = def?.children;
  const childrenMode = inferChildrenMode(childrenConfig, block.children);
  const significant = getSignificantChildren(block.children);

  const inner = (
    <div className="rounded-md border border-blue-200 dark:border-blue-800">
      {/* Component header */}
      <div className="flex items-center gap-1.5 border-b border-blue-100 bg-blue-50 px-2.5 py-1 dark:border-blue-900 dark:bg-blue-950">
        {icon && <span className="text-xs">{icon}</span>}
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{label}</span>
        {/* Show prop values inline */}
        {Object.keys(block.props).length > 0 && (
          <span className="ml-1 text-xs text-blue-400 dark:text-blue-500">
            {Object.entries(block.props)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(" ")}
          </span>
        )}
      </div>

      {/* Children */}
      {childrenMode === "components" && (
        <div className="p-2.5">
          <div className="space-y-2">
            {significant.map((child, index) => (
              <BlockPreview key={index} block={child} />
            ))}
          </div>
        </div>
      )}
      {childrenMode === "markdown" && (
        <div className="p-2.5">
          <RenderedMarkdown content={getMarkdownContent(block.children)} />
        </div>
      )}
    </div>
  );

  if (Wrapper) {
    return <Wrapper>{inner}</Wrapper>;
  }
  return inner;
}
