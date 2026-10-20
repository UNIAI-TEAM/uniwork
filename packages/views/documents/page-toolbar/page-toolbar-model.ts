import type { Editor } from "@tiptap/core";
import {
  Bold, Code, CodeXml, Italic, Link2, List, ListOrdered, ListTodo, Minus, Quote, Redo2,
  Strikethrough, Undo2, type LucideIcon,
} from "lucide-react";
import { PAGE_BLOCKS, type PageBlockId } from "../../editor/extensions/page-blocks";
import type { PageShortcutId } from "../../editor/extensions/page-shortcuts";

export type ToolId =
  | "undo" | "redo" | "bold" | "italic" | "strikethrough" | "code" | "link"
  | "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock" | "horizontalRule"
  | "table" | "image" | "mention";

export interface ToolContext {
  chooseImage: () => void;
  openLink: () => void;
}

export interface ToolbarTool {
  id: ToolId;
  icon: LucideIcon;
  /** Row of the page shortcut table, which `page-shortcuts.test.ts` proves against the real editor. */
  shortcutId?: PageShortcutId;
  /** Typed alias shown instead of a chord (the slash menu entry or the trigger character). */
  alias?: string;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  run: (editor: Editor, context: ToolContext) => void;
}

/** Block tools take their glyph from the slash-menu catalog so the two never drift. */
function blockIcon(id: PageBlockId): LucideIcon {
  return PAGE_BLOCKS.find((block) => block.id === id)!.icon;
}

/**
 * `@` has to arrive as a typed keystroke: the mention picker only opens for a
 * trigger the arming plugin saw through `handleTextInput`, never for text
 * inserted by a command.
 */
export function typeTrigger(editor: Editor, char: string): void {
  const { view } = editor;
  const { from, to } = view.state.selection;
  const handled = view.someProp("handleTextInput", (handler) =>
    handler(view, from, to, char, () => view.state.tr.insertText(char, from, to)));
  if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  view.focus();
}

const TOOLS: Record<ToolId, ToolbarTool> = {
  undo: { id: "undo", icon: Undo2, shortcutId: "undo", isDisabled: (e) => !e.can().undo(), run: (e) => { e.chain().focus().undo().run(); } },
  redo: { id: "redo", icon: Redo2, shortcutId: "redo", isDisabled: (e) => !e.can().redo(), run: (e) => { e.chain().focus().redo().run(); } },
  bold: { id: "bold", icon: Bold, shortcutId: "bold", isActive: (e) => e.isActive("bold"), run: (e) => { e.chain().focus().toggleBold().run(); } },
  italic: { id: "italic", icon: Italic, shortcutId: "italic", isActive: (e) => e.isActive("italic"), run: (e) => { e.chain().focus().toggleItalic().run(); } },
  strikethrough: { id: "strikethrough", icon: Strikethrough, shortcutId: "strike", isActive: (e) => e.isActive("strike"), run: (e) => { e.chain().focus().toggleStrike().run(); } },
  code: { id: "code", icon: Code, shortcutId: "code", isActive: (e) => e.isActive("code"), run: (e) => { e.chain().focus().toggleCode().run(); } },
  // Ctrl/Cmd+K opens this popover while the editor has focus (Word's insert link); app search keeps it elsewhere.
  link: { id: "link", icon: Link2, shortcutId: "link", isActive: (e) => e.isActive("link"), run: (_e, context) => context.openLink() },
  bulletList: { id: "bulletList", icon: List, shortcutId: "bulletList", isActive: (e) => e.isActive("bulletList"), run: (e) => { e.chain().focus().toggleBulletList().run(); } },
  orderedList: { id: "orderedList", icon: ListOrdered, shortcutId: "orderedList", isActive: (e) => e.isActive("orderedList"), run: (e) => { e.chain().focus().toggleOrderedList().run(); } },
  taskList: { id: "taskList", icon: ListTodo, shortcutId: "taskList", isActive: (e) => e.isActive("taskList"), run: (e) => { e.chain().focus().toggleTaskList().run(); } },
  blockquote: { id: "blockquote", icon: Quote, shortcutId: "blockquote", isActive: (e) => e.isActive("blockquote"), run: (e) => { e.chain().focus().toggleBlockquote().run(); } },
  codeBlock: { id: "codeBlock", icon: CodeXml, shortcutId: "codeBlock", isActive: (e) => e.isActive("codeBlock"), run: (e) => { e.chain().focus().toggleCodeBlock().run(); } },
  horizontalRule: { id: "horizontalRule", icon: Minus, alias: "---", run: (e) => { e.chain().focus().setHorizontalRule().run(); } },
  table: { id: "table", icon: blockIcon("table"), alias: "/bang", isDisabled: (e) => e.isActive("table"), run: (e) => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  image: { id: "image", icon: blockIcon("image"), alias: "/anh", run: (_e, context) => context.chooseImage() },
  mention: { id: "mention", icon: blockIcon("mention"), alias: "@", run: (e) => typeTrigger(e, "@") },
};

/** Left to right, a separator between groups. */
export const TOOL_GROUPS: readonly (readonly ToolbarTool[])[] = [
  [TOOLS.undo, TOOLS.redo],
  [TOOLS.bold, TOOLS.italic, TOOLS.strikethrough, TOOLS.code, TOOLS.link],
  [TOOLS.bulletList, TOOLS.orderedList, TOOLS.taskList],
  [TOOLS.blockquote, TOOLS.codeBlock, TOOLS.horizontalRule],
  [TOOLS.table, TOOLS.image, TOOLS.mention],
];

export type TextStyleId = "paragraph" | "heading1" | "heading2" | "heading3";

export interface TextStyle {
  id: TextStyleId;
  shortcutId: PageShortcutId;
  /** Preview size inside the style menu, one step per heading level. */
  previewClass: string;
  run: (editor: Editor) => void;
}

export const TEXT_STYLES: readonly TextStyle[] = [
  { id: "paragraph", shortcutId: "paragraph", previewClass: "text-body-lg", run: (e) => { e.chain().focus().setParagraph().run(); } },
  { id: "heading1", shortcutId: "heading1", previewClass: "text-title-lg font-semibold", run: (e) => { e.chain().focus().setHeading({ level: 1 }).run(); } },
  { id: "heading2", shortcutId: "heading2", previewClass: "text-title font-semibold", run: (e) => { e.chain().focus().setHeading({ level: 2 }).run(); } },
  { id: "heading3", shortcutId: "heading3", previewClass: "text-title-sm font-semibold", run: (e) => { e.chain().focus().setHeading({ level: 3 }).run(); } },
];

export function activeTextStyle(editor: Editor): TextStyleId {
  for (const level of [1, 2, 3] as const) {
    if (editor.isActive("heading", { level })) return `heading${level}`;
  }
  return "paragraph";
}
