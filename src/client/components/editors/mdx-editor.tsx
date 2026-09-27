import { useRef, useEffect, useLayoutEffect, useMemo, useCallback, useImperativeHandle, type MouseEvent, type Ref } from "react";
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_BEFORE_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  MDXEditor,
  type MDXEditorMethods,
  type MDXEditorProps,
  type Realm,
  NESTED_EDITOR_UPDATED_COMMAND,
  activeEditor$,
  createActiveEditorSubscription$,
  rootEditor$,
  realmPlugin,
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
  CodeMirrorEditor,
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
  UndoRedo,
  DiffSourceToggleWrapper,
} from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import { toJsxDescriptors } from "@/client/lib/component-descriptors";
import { selectBlock } from "@/client/stores/inspector-store";
import { CmsImageDialog } from "./cms-image-dialog";
import { componentPalette$, InsertCmsComponent } from "./insert-cms-component";

const hasComponents = Object.keys(components).length > 0;

// The style formatters write, so a save rewrites no more than what was edited.
const MARKDOWN_STYLE: MDXEditorProps["toMarkdownOptions"] = {
  bullet: "-",
  emphasis: "_",
  strong: "*",
  rule: "-",
  listItemIndent: "one",
};

// Typing `/` on an empty line opens the component palette.
function isOnEmptyLine(editor: LexicalEditor): boolean {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

    const node = selection.anchor.getNode();
    const line = $isRootOrShadowRoot(node) ? null : node.getTopLevelElement();

    return $isParagraphNode(line) && line.getTextContentSize() === 0;
  });
}

export interface MdxEditorHandle {
  /** The current markdown, with an edit still pending in a nested editor written back first. */
  flush: () => string;
}

interface MdxEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
  /**
   * Called on each edit inside a component, which reaches `onChange` only once
   * its nested editor loses focus or the editor is flushed.
   */
  onDirty: () => void;
  format: "md" | "mdx";
  ref?: Ref<MdxEditorHandle>;
}

export function MdxEditor({ markdown, onChange, onDirty, format, ref }: MdxEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const realmRef = useRef<Realm | null>(null);
  const onDirtyRef = useRef(onDirty);
  const prevMarkdownRef = useRef(markdown);

  useLayoutEffect(() => {
    onDirtyRef.current = onDirty;
  }, [onDirty]);

  // A block selected in this editor is gone with it, such as when changes are discarded.
  useEffect(() => () => selectBlock(null), []);

  useEffect(() => {
    if (markdown !== prevMarkdownRef.current) {
      prevMarkdownRef.current = markdown;
      editorRef.current?.setMarkdown(markdown);
    }
  }, [markdown]);

  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        realmRef.current?.getValue(activeEditor$)?.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);

        return editorRef.current?.getMarkdown() ?? prevMarkdownRef.current;
      },
    }),
    [],
  );

  // Normalizing the initial markdown is not an edit.
  const handleChange = useCallback(
    (value: string, initialMarkdownNormalize: boolean) => {
      if (initialMarkdownNormalize) return;

      prevMarkdownRef.current = value;
      onChange(value);
    },
    [onChange],
  );

  // A click in the text outside every component leaves nothing selected.
  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;

    if (
      target instanceof Element &&
      event.currentTarget.contains(target) &&
      target.closest(".mdxeditor-root-contenteditable") &&
      !target.closest("[data-cms-block]")
    ) {
      selectBlock(null);
    }
  }, []);

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
      codeBlockPlugin({
        defaultCodeBlockLanguage: "",
        codeBlockEditorDescriptors: [
          {
            priority: 0,
            match: () => true,
            Editor: CodeMirrorEditor,
          },
        ],
      }),
      codeMirrorPlugin({ codeBlockLanguages: {} }),
      diffSourcePlugin({ viewMode: "rich-text" }),
      toolbarPlugin({
        toolbarContents: () => (
          <DiffSourceToggleWrapper options={["rich-text", "source"]}>
            <UndoRedo />
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
      realmPlugin({
        init: (realm) => {
          realmRef.current = realm;
          realm.pub(createActiveEditorSubscription$, [
            // The root editor reports its edits through `onChange` right away.
            (editor: LexicalEditor) =>
              editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
                if (editor !== realm.getValue(rootEditor$) && (dirtyElements.size > 0 || dirtyLeaves.size > 0)) {
                  onDirtyRef.current();
                }
              }),
            // MDXEditor removes a component once its emptied content is
            // backspaced, which for a structured child's content would remove
            // the whole parent. The block menu removes a component instead.
            (editor: LexicalEditor) =>
              editor.registerCommand(
                KEY_BACKSPACE_COMMAND,
                (event) => {
                  if (editor === realm.getValue(rootEditor$) || editor.getRootElement()?.innerText !== "\n") {
                    return false;
                  }

                  event.preventDefault();

                  return true;
                },
                COMMAND_PRIORITY_BEFORE_CRITICAL,
              ),
            (editor: LexicalEditor) =>
              editor.registerCommand(
                KEY_DOWN_COMMAND,
                (event) => {
                  if (!isMdx || !hasComponents || event.key !== "/" || !isOnEmptyLine(editor)) return false;

                  event.preventDefault();
                  realm.pub(componentPalette$, true);

                  return true;
                },
                COMMAND_PRIORITY_LOW,
              ),
          ]);
        },
      })(),
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
    <div onClick={handleClick}>
      <MDXEditor
        ref={editorRef}
        markdown={markdown}
        onChange={handleChange}
        plugins={plugins}
        toMarkdownOptions={MARKDOWN_STYLE}
        contentEditableClassName="prose dark:prose-invert min-h-48 max-w-none p-3"
      />
    </div>
  );
}
