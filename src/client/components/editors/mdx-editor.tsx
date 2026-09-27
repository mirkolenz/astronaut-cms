import { useRef, useEffect, useMemo, useCallback } from "react";
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  jsxPlugin,
  BoldItalicUnderlineToggles,
  CodeToggle,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  DiffSourceToggleWrapper,
} from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import { toJsxDescriptors } from "@client/lib/component-descriptors";
import { CmsImageDialog } from "./cms-image-dialog";
import { InsertCmsComponent } from "./insert-cms-component";

const hasComponents = Object.keys(components).length > 0;

interface MdxEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
  format: "md" | "mdx";
}

export function MdxEditor({ markdown, onChange, format }: MdxEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const prevMarkdownRef = useRef(markdown);

  useEffect(() => {
    if (markdown !== prevMarkdownRef.current) {
      prevMarkdownRef.current = markdown;
      editorRef.current?.setMarkdown(markdown);
    }
  }, [markdown]);

  const handleChange = useCallback(
    (value: string) => {
      prevMarkdownRef.current = value;
      onChange(value);
    },
    [onChange],
  );

  const isMdx = format === "mdx";

  const plugins = useMemo(() => {
    const list = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      imagePlugin({ ImageDialog: CmsImageDialog }),
      tablePlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
      codeMirrorPlugin({ codeBlockLanguages: {} }),
      diffSourcePlugin({ viewMode: "rich-text" }),
      toolbarPlugin({
        toolbarContents: () => (
          <DiffSourceToggleWrapper options={["rich-text", "source"]}>
            <BoldItalicUnderlineToggles />
            <CodeToggle />
            <ListsToggle />
            <BlockTypeSelect />
            <CreateLink />
            <InsertImage />
            <InsertTable />
            <InsertThematicBreak />
            {isMdx && hasComponents && <InsertCmsComponent />}
          </DiffSourceToggleWrapper>
        ),
      }),
    ];

    if (isMdx) {
      const descriptors = toJsxDescriptors(components);
      if (descriptors.length > 0) {
        list.push(jsxPlugin({ jsxComponentDescriptors: descriptors }));
      }
    }

    return list;
  }, [isMdx]);

  return (
    <MDXEditor
      ref={editorRef}
      markdown={markdown}
      onChange={handleChange}
      plugins={plugins}
      contentEditableClassName="prose dark:prose-invert min-h-48 max-w-none"
    />
  );
}
