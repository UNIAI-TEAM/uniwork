import type { Editor } from "@tiptap/core";
import {
  Bold, Code, CodeXml, Italic, Link2, List, ListOrdered, ListTodo, Minus, Quote, Redo2,
  Strikethrough, Undo2, type LucideIcon,
} from "lucide-react";
import { createShortcutChord, type ShortcutChord } from "@uniwork/core/shortcuts";
import { PAGE_BLOCKS, type PageBlockId } from "../../editor/extensions/page-blocks";

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
  /** Exact keyboard chord, only when a test proves the page editor binds it. */
  shortcut?: ShortcutChord;
  /** Typed alias shown instead of a chord (the slash menu entry or the trigger character). */
  alias?: string;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  run: (editor: Editor, context: ToolContext) => void;
}

const primary = (key: string, extra: { shift?: boolean; alt?: boolean } = {}) =>
  createShortcutChord(key, { primary: true, ...extra });

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
  undo: { id: "undo", icon: Undo2, shortcut: primary("Z"), isDisabled: (e) => !e.can().undo(), run: (e) => { e.chain().focus().undo().run(); } },
  redo: { id: "redo", icon: Redo2, shortcut: primary("Z", { shift: true }), isDisabled: (e) => !e.can().redo(), run: (e) => { e.chain().focus().redo().run(); } },
  bold: { id: "bold", icon: Bold, shortcut: primary("B"), isActive: (e) => e.isActive("bold"), run: (e) => { e.chain().focus().toggleBold().run(); } },
  italic: { id: "italic", icon: Italic, shortcut: primary("I"), isActive: (e) => e.isActive("italic"), run: (e) => { e.chain().focus().toggleItalic().run(); } },
  strikethrough: { id: "strikethrough", icon: Strikethrough, shortcut: primary("S", { shift: true }), isActive: (e) => e.isActive("strike"), run: (e) => { e.chain().focus().toggleStrike().run(); } },
  code: { id: "code", icon: Code, shortcut: primary("E"), isActive: (e) => e.isActive("code"), run: (e) => { e.chain().focus().toggleCode().run(); } },
  // No chord: Ctrl/Cmd+K is the app-wide search, and the page editor binds no link shortcut.
  link: { id: "link", icon: Link2, isActive: (e) => e.isActive("link"), run: (_e, context) => context.openLink() },
  bulletList: { id: "bulletList", icon: List, shortcut: primary("8", { shift: true }), isActive: (e) => e.isActive("bulletList"), run: (e) => { e.chain().focus().toggleBulletList().run(); } },
  orderedList: { id: "orderedList", icon: ListOrdered, shortcut: primary("7", { shift: true }), isActive: (e) => e.isActive("orderedList"), run: (e) => { e.chain().focus().toggleOrderedList().run(); } },
  taskList: { id: "taskList", icon: ListTodo, shortcut: primary("9", { shift: true }), isActive: (e) => e.isActive("taskList"), run: (e) => { e.chain().focus().toggleTaskList().run(); } },
  blockquote: { id: "blockquote", icon: Quote, shortcut: primary("B", { shift: true }), isActive: (e) => e.isActive("blockquote"), run: (e) => { e.chain().focus().toggleBlockquote().run(); } },
  codeBlock: { id: "codeBlock", icon: CodeXml, shortcut: primary("C", { alt: true }), isActive: (e) => e.isActive("codeBlock"), run: (e) => { e.chain().focus().toggleCodeBlock().run(); } },
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
  shortcut: ShortcutChord;
  /** Preview size inside the style menu, one step per heading level. */
  previewClass: string;
  run: (editor: Editor) => void;
}

export const TEXT_STYLES: readonly TextStyle[] = [
  { id: "paragraph", shortcut: primary("0", { alt: true }), previewClass: "text-body-lg", run: (e) => { e.chain().focus().setParagraph().run(); } },
  { id: "heading1", shortcut: primary("1", { alt: true }), previewClass: "text-title-lg font-semibold", run: (e) => { e.chain().focus().setHeading({ level: 1 }).run(); } },
  { id: "heading2", shortcut: primary("2", { alt: true }), previewClass: "text-title font-semibold", run: (e) => { e.chain().focus().setHeading({ level: 2 }).run(); } },
  { id: "heading3", shortcut: primary("3", { alt: true }), previewClass: "text-title-sm font-semibold", run: (e) => { e.chain().focus().setHeading({ level: 3 }).run(); } },
];

export function activeTextStyle(editor: Editor): TextStyleId {
  for (const level of [1, 2, 3] as const) {
    if (editor.isActive("heading", { level })) return `heading${level}`;
  }
  return "paragraph";
}
