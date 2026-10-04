"use client";

/**
 * Editor state + commands for the Markdown command row (M2).
 *
 * The controls are a view over the M1 editor: active state is read from the
 * live TipTap instance through `useEditorState` (a precise subscription, so a
 * keystroke does not re-render the row), and every command is a chained
 * editor command. Nothing here owns document state - the editor writes back
 * through the shared text source, exactly as M1 established.
 */
import { useMemo } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { readCodeBlock } from "../code-block";
import { insertMermaidDiagram } from "../diagram";
import { applyMath, readMathSelection } from "../math";
import { blockStyleOf, headingLevelOf } from "./groups";
import type {
  MarkdownBlockStyle,
  MarkdownInlineMark,
  MarkdownListKind,
  MarkdownToolbarActions,
  MarkdownToolbarState,
} from "./types";

/** What the row shows before the editor instance exists (or when read-only). */
const EMPTY_MARKDOWN_TOOLBAR_STATE: MarkdownToolbarState = {
  readOnly: true,
  activeBlock: "paragraph",
  marks: { bold: false, italic: false, strike: false, inlineCode: false },
  link: null,
  lists: { bullet: false, ordered: false, task: false },
  outline: false,
  frontmatter: false,
  math: null,
  codeBlock: null,
};

/** The state the editor reports on its own; the pane toggles are the caller's. */
type MarkdownEditorToolbarState = Omit<MarkdownToolbarState, "readOnly" | "outline" | "frontmatter">;

function readEditorState(editor: Editor): MarkdownEditorToolbarState {
  const headingLevel = editor.isActive("heading") ? (editor.getAttributes("heading").level as number | undefined) : null;
  const activeBlock: MarkdownBlockStyle = editor.isActive("blockquote")
    ? "quote"
    : editor.isActive("codeBlock")
      ? "code"
      : blockStyleOf(headingLevel);
  const linkActive = editor.isActive("link");
  const linkAttrs = linkActive ? (editor.getAttributes("link") as { href?: string; title?: string | null }) : null;
  return {
    activeBlock,
    marks: {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      inlineCode: editor.isActive("code"),
    },
    link: linkActive && linkAttrs?.href ? { href: linkAttrs.href, title: linkAttrs.title ?? null } : null,
    lists: {
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      task: editor.isActive("taskList"),
    },
    math: readMathSelection(editor),
    codeBlock: readCodeBlock(editor),
  };
}

/** Subscribe to the editor state the row renders. Null editor = empty state. */
export function useMarkdownEditorToolbarState(editor: Editor | null): MarkdownEditorToolbarState {
  const selected = useEditorState({
    editor,
    selector: ({ editor: live }) => (live ? readEditorState(live) : null),
  });
  return selected ?? EMPTY_MARKDOWN_TOOLBAR_STATE;
}

/**
 * The row's commands. `insertImage` is absent until M5 wires asset upload, so
 * the image control renders disabled with a "not available yet" tooltip rather
 * than offering an insert the document could not keep.
 *
 * Every command is guarded by `editor.isEditable`, not only by the disabled
 * surface. The controls are one way in - a ribbon custom item, a menu entry or
 * a future host could call an action directly - and a command that mutated a
 * non-editable document would publish the change back to the source as a dirty
 * edit the user cannot undo. The guard sits at the one place every action
 * funnels through, so each is inert no matter which surface invoked it.
 */
export function useMarkdownToolbarActions(editor: Editor | null, options: { insertImage?: () => void } = {}): MarkdownToolbarActions {
  const insertImage = options.insertImage;
  return useMemo<MarkdownToolbarActions>(
    () => ({
      setBlockStyle(style) {
        if (!editor?.isEditable) return;
        const chain = editor.chain().focus();
        const level = headingLevelOf(style);
        if (level !== null) chain.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        else if (style === "quote") chain.setParagraph().toggleBlockquote().run();
        else if (style === "code") chain.toggleCodeBlock().run();
        else chain.setParagraph().run();
      },
      toggleMark(mark: MarkdownInlineMark) {
        if (!editor?.isEditable) return;
        const chain = editor.chain().focus();
        if (mark === "bold") chain.toggleBold().run();
        else if (mark === "italic") chain.toggleItalic().run();
        else if (mark === "strike") chain.toggleStrike().run();
        else chain.toggleCode().run();
      },
      applyLink(href, title) {
        if (!editor?.isEditable) return;
        editor
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href, title: title && title.length > 0 ? title : null })
          .run();
      },
      removeLink() {
        if (!editor?.isEditable) return;
        editor.chain().focus().extendMarkRange("link").unsetLink().run();
      },
      toggleList(list: MarkdownListKind) {
        if (!editor?.isEditable) return;
        const chain = editor.chain().focus();
        if (list === "bullet") chain.toggleBulletList().run();
        else if (list === "ordered") chain.toggleOrderedList().run();
        else chain.toggleTaskList().run();
      },
      insertTable() {
        if (!editor?.isEditable) return;
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      },
      insertImage: insertImage
        ? () => {
            insertImage();
          }
        : undefined,
      insertHorizontalRule() {
        if (!editor?.isEditable) return;
        editor.chain().focus().setHorizontalRule().run();
      },
      insertDiagram() {
        if (!editor?.isEditable) return;
        insertMermaidDiagram(editor);
      },
      insertMath(kind, expression) {
        if (!editor?.isEditable) return;
        applyMath(editor, kind, expression);
      },
      setCodeBlockLanguage(language) {
        if (!editor?.isEditable) return;
        editor.chain().focus().updateAttributes("codeBlock", { language }).run();
      },
      copyCodeBlock() {
        return copyText(readCodeBlock(editor)?.text ?? "");
      },
    }),
    [editor, insertImage],
  );
}
