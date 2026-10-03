import type { Command } from "@tiptap/pm/state";
import { docxTableContext, tableRowPos } from "./table-selection";
import { DEFAULT_TABLE_LOOK, tableHeaderRowState, type DocxTableLook } from "./table-state";

/**
 * Word's "Header Row" table style option (w:tblLook firstRow). The cell type of
 * the first row flips with it so the emphasis is visible immediately; the
 * tblLook bit is what the save plan carries (the header cell type itself is a
 * display detail, see the A10 worker report).
 */
export function toggleFirstRowHeader(): Command {
  return (state, dispatch) => {
    const ctx = docxTableContext(state);
    if (!ctx) return false;
    const next = !tableHeaderRowState(ctx.table);
    const look: DocxTableLook = { ...((ctx.table.attrs.tblLook as DocxTableLook | null) ?? DEFAULT_TABLE_LOOK) };
    look.firstRow = next;
    let tr = state.tr.setNodeMarkup(ctx.tablePos, undefined, {
      ...ctx.table.attrs,
      tblLook: look,
      tblLookEdited: true,
    });
    const row = ctx.table.firstChild;
    const target = next ? state.schema.nodes.docTableHeader : state.schema.nodes.docTableCell;
    if (row && target) {
      // forEach offsets are relative to the row's content, which starts one
      // position after the row node itself (ctx.tableStart).
      row.forEach((cell, cellOffset) => {
        if (cell.type !== target) tr = tr.setNodeMarkup(ctx.tableStart + 1 + cellOffset, target, cell.attrs);
      });
    }
    dispatch?.(tr);
    return true;
  };
}

/**
 * Word's "Repeat Header Rows" (w:trPr w:tblHeader): toggles every leading row
 * of the selection; a whole-table node selection toggles just row 0, because
 * only starting rows can repeat across pages. Refused when the selection starts
 * below row 0 (the repeat state is not defined there).
 */
export function toggleRepeatHeaderRows(): Command {
  return (state, dispatch) => {
    const ctx = docxTableContext(state);
    if (!ctx) return false;
    const bottom = ctx.wholeTable ? 1 : ctx.rect.top === 0 ? ctx.rect.bottom : 0;
    if (bottom < 1) return false;
    let active = true;
    for (let index = 0; index < bottom; index += 1) {
      if (ctx.table.child(index)?.attrs.repeatHeader !== true) active = false;
    }
    let tr = state.tr;
    for (let index = 0; index < bottom; index += 1) {
      const row = ctx.table.child(index);
      tr = tr.setNodeMarkup(tableRowPos(ctx, index), undefined, {
        ...row.attrs,
        repeatHeader: !active,
        repeatHeaderEdited: true,
      });
    }
    dispatch?.(tr);
    return true;
  };
}
