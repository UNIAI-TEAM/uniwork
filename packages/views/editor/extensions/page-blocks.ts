import type { Editor, Range } from "@tiptap/core";
import {
  AlignLeft, AtSign, Code2, Heading1, Heading2, Heading3, ImagePlus,
  List, ListOrdered, ListTodo, Minus, Quote, Table2, type LucideIcon,
} from "lucide-react";

export type PageBlockId = "paragraph" | "heading1" | "heading2" | "heading3" | "bulletList"
  | "orderedList" | "taskList" | "blockquote" | "codeBlock" | "horizontalRule" | "table" | "image" | "mention";
export interface PageBlock {
  id: PageBlockId;
  nodeType: string;
  icon: LucideIcon;
}
export type PageTranslate = (key: string, options?: { lng?: string }) => string;

export const PAGE_BLOCKS: readonly PageBlock[] = [
  { id: "paragraph", nodeType: "paragraph", icon: AlignLeft },
  { id: "heading1", nodeType: "heading", icon: Heading1 },
  { id: "heading2", nodeType: "heading", icon: Heading2 },
  { id: "heading3", nodeType: "heading", icon: Heading3 },
  { id: "bulletList", nodeType: "bulletList", icon: List },
  { id: "orderedList", nodeType: "orderedList", icon: ListOrdered },
  { id: "taskList", nodeType: "taskList", icon: ListTodo },
  { id: "blockquote", nodeType: "blockquote", icon: Quote },
  { id: "codeBlock", nodeType: "codeBlock", icon: Code2 },
  { id: "horizontalRule", nodeType: "horizontalRule", icon: Minus },
  { id: "table", nodeType: "table", icon: Table2 },
  { id: "image", nodeType: "image", icon: ImagePlus },
  { id: "mention", nodeType: "mention", icon: AtSign },
];

function normalized(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

export function filterPageBlocks(query: string, t: PageTranslate): PageBlock[] {
  const search = normalized(query.trim());
  return PAGE_BLOCKS.filter((block) => !search || ["vi", "en"].some((lng) =>
    normalized(t(`documents.page_ui.blocks.${block.id}.label`, { lng })).includes(search)));
}

/** The chain runs only existing page-schema commands, never chat skill nodes. */
export function insertPageBlock(editor: Editor, range: Range, id: PageBlockId, chooseImage?: () => void): void {
  const chain = editor.chain().focus().deleteRange(range);
  switch (id) {
    case "paragraph": chain.setParagraph().run(); break;
    case "heading1": chain.setHeading({ level: 1 }).run(); break;
    case "heading2": chain.setHeading({ level: 2 }).run(); break;
    case "heading3": chain.setHeading({ level: 3 }).run(); break;
    case "bulletList": chain.toggleBulletList().run(); break;
    case "orderedList": chain.toggleOrderedList().run(); break;
    case "taskList": chain.toggleTaskList().run(); break;
    case "blockquote": chain.toggleBlockquote().run(); break;
    case "codeBlock": chain.setCodeBlock().run(); break;
    case "horizontalRule": chain.setHorizontalRule().run(); break;
    case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
    case "image": chain.run(); chooseImage?.(); break;
    case "mention": chain.insertContent("@").run(); break;
  }
}
