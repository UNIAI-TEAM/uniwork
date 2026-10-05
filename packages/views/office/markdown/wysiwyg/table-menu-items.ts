/**
 * The Markdown table context toolbar's commands (M3).
 *
 * Pure data plus one visibility predicate: the eight table commands the brief
 * names, each a single chained TipTap table command. Keeping the commands here
 * (not inside the component) is what lets the actions be pinned without a
 * mounted popup, and it is the same split M2 uses for its group definitions.
 *
 * The visibility predicate is the C9 contract for this surface: the toolbar is
 * CONTEXTUAL - it exists only while the selection sits inside a table. There is
 * no floating command button over the canvas.
 */
import type { Editor } from "@tiptap/core";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Rows3,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";

export type MarkdownTableMenuActionId =
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "toggleHeaderRow"
  | "deleteTable";

export interface MarkdownTableMenuAction {
  id: MarkdownTableMenuActionId;
  /** i18next key holding the accessible name and the tooltip. */
  labelKey: string;
  icon: LucideIcon;
  /** The one chained command this action runs. */
  run: (editor: Editor) => void;
}

/** The i18next key holding one action's label. */
export function markdownTableMenuLabelKey(id: MarkdownTableMenuActionId): string {
  return `office.markdown.table.${id}`;
}

/**
 * The toolbar's actions in reading order: rows, then columns, then the two
 * destructive/structural ones. Delete table is separated in the UI.
 */
export const MARKDOWN_TABLE_MENU_ACTIONS: readonly MarkdownTableMenuAction[] = [
  { id: "addRowBefore", labelKey: markdownTableMenuLabelKey("addRowBefore"), icon: ArrowUpToLine, run: (editor) => void editor.chain().focus().addRowBefore().run() },
  { id: "addRowAfter", labelKey: markdownTableMenuLabelKey("addRowAfter"), icon: ArrowDownToLine, run: (editor) => void editor.chain().focus().addRowAfter().run() },
  { id: "addColumnBefore", labelKey: markdownTableMenuLabelKey("addColumnBefore"), icon: ArrowLeftToLine, run: (editor) => void editor.chain().focus().addColumnBefore().run() },
  { id: "addColumnAfter", labelKey: markdownTableMenuLabelKey("addColumnAfter"), icon: ArrowRightToLine, run: (editor) => void editor.chain().focus().addColumnAfter().run() },
  { id: "deleteRow", labelKey: markdownTableMenuLabelKey("deleteRow"), icon: Rows3, run: (editor) => void editor.chain().focus().deleteRow().run() },
  { id: "deleteColumn", labelKey: markdownTableMenuLabelKey("deleteColumn"), icon: Columns3, run: (editor) => void editor.chain().focus().deleteColumn().run() },
  { id: "toggleHeaderRow", labelKey: markdownTableMenuLabelKey("toggleHeaderRow"), icon: Table2, run: (editor) => void editor.chain().focus().toggleHeaderRow().run() },
  { id: "deleteTable", labelKey: markdownTableMenuLabelKey("deleteTable"), icon: Trash2, run: (editor) => void editor.chain().focus().deleteTable().run() },
];

/**
 * True when the table toolbar must be offered: the editor is editable and the
 * selection (cursor or range) sits inside a table. A read-only document gets no
 * toolbar at all rather than a row of inert buttons.
 */
export function isMarkdownTableMenuVisible(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || editor.isDestroyed) return false;
  return editor.isActive("table");
}

/** The document position of the table the selection is inside, or null. */
export function findTablePosition(editor: Editor | null): number | null {
  if (!editor) return null;
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "table") return $from.before(depth);
  }
  return null;
}
