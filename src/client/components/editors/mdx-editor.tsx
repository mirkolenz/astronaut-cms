import {
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useImperativeHandle,
  type ClipboardEvent,
  type CSSProperties,
  type MouseEvent,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import type { Root } from "mdast";
import { defaultHandlers } from "mdast-util-to-markdown";
import {
  COMMAND_PRIORITY_BEFORE_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
} from "lexical";
import {
  MDXEditor,
  type MDXEditorMethods,
  type MDXEditorProps,
  type Realm,
  NESTED_EDITOR_UPDATED_COMMAND,
  activeEditor$,
  addComposerChild$,
  addExportVisitor$,
  addToMarkdownExtension$,
  createActiveEditorSubscription$,
  createRootEditorSubscription$,
  historyState$,
  rootEditor$,
  setMarkdown$,
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
  DiffSourceToggleWrapper,
} from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import { toJsxDescriptors } from "@/client/lib/component-descriptors";
import { $caretBlock, $isEmptyLine, $isSkippedLine, pruneEmptyLines } from "@/client/lib/empty-lines";
import { isComponentMdx, parseMdx, pasteText } from "@/client/lib/editor-content";
import { createSourcePreserver } from "@/client/lib/markdown-source";
import { blockActions, blockMdx } from "@/client/lib/block-editing";
import { getSelectedBlock, select, setBodyRealm } from "@/client/stores/inspector-store";
import { syncHistory } from "@/client/stores/form-store";
import { pageHistory, registerSkipUnchanged } from "@/client/lib/page-history";
import { CmsImageDialog } from "@/client/components/editors/cms-image-dialog";
import { GapInserter } from "@/client/components/editors/gap-inserter";
import { InsertButton, InsertMenu, insertTarget$ } from "@/client/components/editors/insert-menu";

// The style edited blocks are written in. The others keep their source text.
const MARKDOWN_STYLE: MDXEditorProps["toMarkdownOptions"] = {
  bullet: "-",
  emphasis: "_",
  strong: "*",
  rule: "-",
  listItemIndent: "one",
};

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
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MDXEditorMethods>(null);
  const realmRef = useRef<Realm | null>(null);
  const onDirtyRef = useRef(onDirty);
  const prevMarkdownRef = useRef(markdown);
  // The markdown the editor content was last loaded from.
  const sourceRef = useRef(markdown);

  useLayoutEffect(() => {
    onDirtyRef.current = onDirty;
  }, [onDirty]);

  useEffect(() => {
    setBodyRealm(realmRef.current);

    return () => setBodyRealm(null);
  }, []);

  // A focused component block takes the clipboard and delete keys before the editor around it.
  useEffect(() => {
    const controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    const focusedBlock = () => {
      const active = document.activeElement;

      return active?.hasAttribute("data-cms-block") && wrapperRef.current?.contains(active)
        ? getSelectedBlock()
        : null;
    };
    const clipboard = (event: globalThis.ClipboardEvent) => {
      const block = focusedBlock();
      const mdx = block ? blockMdx(block) : undefined;

      if (!block || mdx === undefined) return;

      event.preventDefault();
      event.stopPropagation();
      event.clipboardData?.setData("text/plain", mdx);

      if (event.type === "cut") blockActions(block).remove();
    };

    document.addEventListener("copy", clipboard, options);
    document.addEventListener("cut", clipboard, options);
    document.addEventListener(
      "keydown",
      (event) => {
        const block = focusedBlock();

        if (!block || (event.key !== "Backspace" && event.key !== "Delete")) return;

        event.preventDefault();
        event.stopPropagation();
        blockActions(block).remove();
      },
      options,
    );

    return () => controller.abort();
  }, []);

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
      select(null);
    }
  }, []);

  const isMdx = format === "mdx";

  // Text written as a component, such as a copied one, is pasted as that component.
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const realm = realmRef.current;
      const text = event.clipboardData.getData("text/plain");
      const target = event.target;
      // Code blocks and dialogs take the text as it is.
      const editable = target instanceof Element ? target.closest('[contenteditable="true"]') : null;
      const editor = editable?.hasAttribute("data-lexical-editor") ? getNearestEditorFromDOMNode(editable) : null;

      if (!isMdx || !realm || !editor || !isComponentMdx(text)) return;

      event.preventDefault();
      event.stopPropagation();
      pasteText(realm, { editor }, text);
    },
    [isMdx],
  );

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
            <BoldItalicUnderlineToggles />
            <CodeToggle />
            <ListsToggle />
            <BlockTypeSelect />
            <CreateLink />
            <InsertButton />
          </DiffSourceToggleWrapper>
        ),
      }),
      realmPlugin({
        init: (realm) => {
          realmRef.current = realm;

          const preserveSource = createSourcePreserver((value) => parseMdx(realm, value));
          let previousEditor: LexicalEditor | null = null;

          realm.sub(setMarkdown$, (value) => {
            sourceRef.current = value;
          });
          // Leaving an editor leaves no empty lines behind in it.
          realm.sub(activeEditor$, (editor) => {
            if (previousEditor && previousEditor !== editor && previousEditor.getRootElement()) {
              pruneEmptyLines(previousEditor, { keepCaret: false });
            }

            previousEditor = editor;
          });
          realm.pub(addComposerChild$, [InsertMenu, GapInserter]);
          realm.pub(addExportVisitor$, { testLexicalNode: $isSkippedLine, visitLexicalNode: () => {}, priority: 1 });
          realm.pub(addToMarkdownExtension$, {
            handlers: {
              root: (node: Root, parent, state, info) =>
                preserveSource(sourceRef.current, defaultHandlers.root(node, parent, state, info)),
            },
          });
          // The body's editors share the page's history with its forms, and the
          // buttons follow it, which also changes as a nested editor writes itself back.
          realm.pub(historyState$, pageHistory);
          realm.pub(createRootEditorSubscription$, (editor: LexicalEditor) =>
            editor.registerUpdateListener(syncHistory),
          );
          realm.pub(createActiveEditorSubscription$, [
            registerSkipUnchanged,
            (editor: LexicalEditor) => editor.registerUpdateListener(syncHistory),
            // The root editor reports its edits through `onChange` right away.
            (editor: LexicalEditor) =>
              editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
                if (editor !== realm.getValue(rootEditor$) && (dirtyElements.size > 0 || dirtyLeaves.size > 0)) {
                  onDirtyRef.current();
                }
              }),
            // An empty line goes once the caret has left it.
            (editor: LexicalEditor) => {
              let caret: string | null | undefined;

              return editor.registerUpdateListener(({ editorState }) => {
                const next = editorState.read(() => $caretBlock()?.getKey() ?? null);

                if (next === caret) return;

                caret = next;
                pruneEmptyLines(editor);
              });
            },
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
            // Typing `/` on an empty line opens the insert menu.
            (editor: LexicalEditor) =>
              editor.registerCommand(
                KEY_DOWN_COMMAND,
                (event) => {
                  if (event.key !== "/" || !editor.getEditorState().read(() => $isEmptyLine($caretBlock()))) {
                    return false;
                  }

                  event.preventDefault();
                  realm.pub(insertTarget$, { editor });

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
    <div
      ref={wrapperRef}
      onClick={handleClick}
      onPasteCapture={handlePaste}
      style={{ "--cms-empty-line": JSON.stringify(t(($) => $.editors.emptyLine)) } as CSSProperties}
    >
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
