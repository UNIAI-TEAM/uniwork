import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { TableMap, isInTable, selectedRect, type TableRect } from "@tiptap/pm/tables";

/**
 * The table frame the table UI (task A10) works against. A caret inside a cell
 * and a whole-table node selection (the vendored move handle) both resolve to a
 * context, so one command set covers both entry points.
 */
export interface DocxTableContext {
  table: PmNode;
  /** Position of the table node itself. */
  tablePos: number;
  /** Position just inside the table — the frame `selectedRect` reports. */
  tableStart: number;
  /** Cell rectangle covered by the selection; the whole grid for a node selection. */
  rect: TableRect;
  /** True when a whole-table NodeSelection produced this context. */
  wholeTable: boolean;
}

/** Resolves the DOCX table under the selection, or null when there is none. */
export function docxTableContext(state: EditorState): DocxTableContext | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === "docTable") {
    const table = selection.node;
    const tableStart = selection.from + 1;
    const map = TableMap.get(table);
    return {
      table,
      tablePos: selection.from,
      tableStart,
      rect: { left: 0, right: map.width, top: 0, bottom: table.childCount, tableStart, map, table },
      wholeTable: true,
    };
  }
  if (!isInTable(state)) return null;
  try {
    const rect = selectedRect(state);
    if (rect.table.type.name !== "docTable") return null;
    return { table: rect.table, tablePos: rect.tableStart - 1, tableStart: rect.tableStart, rect, wholeTable: false };
  } catch {
    // selectedRect throws on selections the table map cannot resolve (e.g. a
    // DOM selection spanning outside the table); treated as "not in a table".
    return null;
  }
}

/** The position between a table's rows for row index `index`. */
export function tableRowPos(ctx: DocxTableContext, index: number): number {
  let pos = ctx.tableStart;
  for (let at = 0; at < index; at += 1) {
    pos += ctx.table.child(at)?.nodeSize ?? 0;
  }
  return pos;
}

/**
 * A whole-table NodeSelection (the move handle) is not "in" the table for the
 * cell-grid commands (add/delete/merge/split); drop the caret into the first
 * cell first, the same way the vendored renderer does.
 */
export function enterFirstTableCell(editor: Editor): void {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "docTable") return;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(selection.from + 1))),
  );
}
