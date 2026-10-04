/**
 * The Markdown slash menu's item set, filter and insert commands (M3).
 *
 * The menu is the SAME suggestion machinery the page-document editor already
 * uses (`slash.ts` mounts a `Suggestion` plugin through
 * `createSuggestionPopupRender` + `isTriggerArmedAt`); this module supplies only
 * what Markdown adds: the 14 block items the brief names, the diacritic-aware
 * filter that runs as the user types, and one insert command per item.
 *
 * Inserts reuse the M2/M4 helpers instead of re-implementing them: a diagram is
 * `insertMermaidDiagram` (M4), a formula is `applyMath` (M4), and the table is
 * the same 3x3-with-header table M2's Insert group creates. Image is a host
 * port (`chooseImage`) because the asset upload path belongs to M5.
 */
import type { Editor, Range } from "@tiptap/core";
import {
  AlignLeft,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Sigma,
  Table2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { PageTranslate } from "../../../editor/extensions/page-blocks";
import { insertMermaidDiagram } from "./diagram";
import { applyMath } from "./math";

/** The item ids, in menu order. Each one is also its `office.markdown.slash.*` key. */
export type MarkdownSlashItemId =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "table"
  | "hr"
  | "math"
  | "diagram"
  | "image";

/**
 * The translate shape the filter needs. It IS `PageTranslate` (the page slash
 * menu's own type) rather than a second copy of the same signature, so the two
 * menus stay one contract.
 */
export type MarkdownSlashTranslate = PageTranslate;

export interface MarkdownSlashItem {
  id: MarkdownSlashItemId;
  icon: LucideIcon;
  /**
   * Extra ASCII search terms. The visible label is translated, so a user typing
   * `/h2`, `/mermaid` or `/todo` would otherwise match nothing: the aliases make
   * the filter answer the shorthand people actually type.
   */
  aliases: readonly string[];
}

/** Every item the Markdown slash menu offers, in the brief's order. */
export const MARKDOWN_SLASH_ITEMS: readonly MarkdownSlashItem[] = [
  { id: "paragraph", icon: AlignLeft, aliases: ["text", "body"] },
  { id: "heading1", icon: Heading1, aliases: ["h1", "title"] },
  { id: "heading2", icon: Heading2, aliases: ["h2"] },
  { id: "heading3", icon: Heading3, aliases: ["h3"] },
  { id: "bulletList", icon: List, aliases: ["bullet", "unordered", "ul"] },
  { id: "orderedList", icon: ListOrdered, aliases: ["numbered", "ordered", "ol"] },
  { id: "taskList", icon: ListTodo, aliases: ["task", "todo", "checkbox", "checklist"] },
  { id: "quote", icon: Quote, aliases: ["blockquote", "citation"] },
  { id: "codeBlock", icon: Code2, aliases: ["code", "fence", "pre"] },
  { id: "table", icon: Table2, aliases: ["grid"] },
  { id: "hr", icon: Minus, aliases: ["divider", "rule", "separator"] },
  { id: "math", icon: Sigma, aliases: ["formula", "latex", "katex", "equation"] },
  { id: "diagram", icon: Workflow, aliases: ["mermaid", "flowchart", "graph"] },
  { id: "image", icon: ImagePlus, aliases: ["img", "picture", "photo"] },
];

/** The i18next key holding one item's visible label. */
export function markdownSlashLabelKey(id: MarkdownSlashItemId): string {
  return `office.markdown.slash.${id}`;
}

/**
 * Diacritic-insensitive lowercase form, so `/tieu de` matches "Tiêu đề" and
 * `/bang` matches "Bảng". Mirrors the private helper in the page menu's
 * `page-blocks.ts`; it is not exported there, so the two lines are repeated
 * rather than reached through a new shared module.
 */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/**
 * The items matching a typed query, in menu order. A query matches the id, an
 * alias, or the label in EITHER locale (vi and en), so a Vietnamese user typing
 * an English term still finds the block and vice versa.
 */
export function filterMarkdownSlashItems(
  query: string,
  translate: MarkdownSlashTranslate,
): MarkdownSlashItem[] {
  const search = normalize(query.trim());
  if (!search) return [...MARKDOWN_SLASH_ITEMS];
  return MARKDOWN_SLASH_ITEMS.filter((item) => {
    const labels = ["vi", "en"].map((lng) => translate(markdownSlashLabelKey(item.id), { lng }));
    return [item.id, ...item.aliases, ...labels].some((candidate) => normalize(candidate).includes(search));
  });
}

export interface MarkdownSlashInsertOptions {
  /** Host port for the image entry (M5). Absent -> the pick is a no-op. */
  chooseImage?: () => void;
}

/**
 * Insert one item at the slash range. The typed `/query` is removed first, so
 * the picked block replaces the trigger exactly as the page menu does.
 */
export function insertMarkdownSlashItem(
  editor: Editor,
  range: Range,
  id: MarkdownSlashItemId,
  options: MarkdownSlashInsertOptions = {},
): void {
  const chain = editor.chain().focus().deleteRange(range);
  switch (id) {
    case "paragraph":
      chain.setParagraph().run();
      return;
    case "heading1":
      chain.setHeading({ level: 1 }).run();
      return;
    case "heading2":
      chain.setHeading({ level: 2 }).run();
      return;
    case "heading3":
      chain.setHeading({ level: 3 }).run();
      return;
    case "bulletList":
      chain.toggleBulletList().run();
      return;
    case "orderedList":
      chain.toggleOrderedList().run();
      return;
    case "taskList":
      chain.toggleTaskList().run();
      return;
    case "quote":
      chain.toggleBlockquote().run();
      return;
    case "codeBlock":
      chain.setCodeBlock().run();
      return;
    case "table":
      // The same table M2's Insert group creates, so the two entry points agree.
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
    case "hr":
      chain.setHorizontalRule().run();
      return;
    case "math":
      // M4 owns the node and the paste path; an empty formula is inserted and
      // the user fills it through the M4 math popover.
      chain.run();
      applyMath(editor, "block", "");
      return;
    case "diagram":
      chain.run();
      insertMermaidDiagram(editor);
      return;
    case "image":
      // The upload path is M5's; without the port the entry is inert rather
      // than inserting an image the document could not keep.
      chain.run();
      options.chooseImage?.();
      return;
  }
}
