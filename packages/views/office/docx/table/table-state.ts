import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { CellSelection, selectionCell } from "@tiptap/pm/tables";
import { docxTableContext, type DocxTableContext } from "./table-selection";

/** The cell/table attributes the table toolbar mirrors back to the user. */
export interface DocxTableFormatState {
  /** The caret or a whole-table node selection resolves to a `docTable`. */
  inTable: boolean;
  /** A cell selection spans more than one cell. */
  canMergeCells: boolean;
  /** The selected cell carries a colspan/rowspan from an earlier merge. */
  canSplitCell: boolean;
  /** First-row emphasis (w:tblLook firstRow, Word's "Header Row" style option). */
  headerRow: boolean;
  /** The selected leading rows can be toggled as repeating table headers. */
  canRepeatHeaderRows: boolean;
  /** Every selected leading row repeats across pages (w:trPr w:tblHeader). */
  repeatHeaderRows: boolean;
}

/** Word's Table Style Options (w:tblLook); also the value the header toggle writes. */
export interface DocxTableLook {
  firstRow: boolean;
  lastRow: boolean;
  firstColumn: boolean;
  lastColumn: boolean;
  bandedRows: boolean;
  bandedColumns: boolean;
}

/** Word's defaults for a table without a declared w:tblLook. */
export const DEFAULT_TABLE_LOOK: DocxTableLook = {
  firstRow: true,
  lastRow: false,
  firstColumn: true,
  lastColumn: false,
  bandedRows: true,
  bandedColumns: false,
};

/** The all-off state read before a document opens or outside a table. */
export const EMPTY_TABLE_FORMAT_STATE: DocxTableFormatState = {
  inTable: false,
  canMergeCells: false,
  canSplitCell: false,
  headerRow: false,
  canRepeatHeaderRows: false,
  repeatHeaderRows: false,
};

/** The table's effective first-row emphasis: an explicit w:tblLook firstRow wins,
 * otherwise the first row's header cells are the display-side signal. */
export function tableHeaderRowState(table: PmNode): boolean {
  const look = table.attrs.tblLook as DocxTableLook | null;
  return look ? look.firstRow : table.firstChild?.firstChild?.type.name === "docTableHeader";
}

/** Reads the table context the toolbar reflects: in-table, merge/split availability,
 * first-row emphasis and the repeating-header rows. */
export function readTableFormatState(editor: Editor | null): DocxTableFormatState {
  if (!editor || editor.isDestroyed) return EMPTY_TABLE_FORMAT_STATE;
  const ctx = docxTableContext(editor.state);
  if (!ctx) return EMPTY_TABLE_FORMAT_STATE;
  const { selection } = editor.state;
  const mergeSize = (ctx.rect.right - ctx.rect.left) * (ctx.rect.bottom - ctx.rect.top);
  let cell: PmNode | null = null;
  try {
    const $cell = selectionCell(editor.state);
    cell = $cell ? editor.state.doc.nodeAt($cell.pos) : null;
  } catch {
    // selectionCell throws when the selection resolves no cell; read it as
    // "no cell" so the rest of the toolbar state still resolves.
  }
  const repeat = repeatHeaderState(ctx);
  return {
    inTable: true,
    canMergeCells: selection instanceof CellSelection && mergeSize > 1,
    canSplitCell: cell !== null && (Number(cell.attrs.colspan ?? 1) > 1 || Number(cell.attrs.rowspan ?? 1) > 1),
    headerRow: tableHeaderRowState(ctx.table),
    canRepeatHeaderRows: repeat.enabled,
    repeatHeaderRows: repeat.active,
  };
}

/** genoffice rule: repeat-header applies to the leading rows only (rect.top === 0);
 * a whole-table node selection covers row 0, so it may toggle. */
export function repeatHeaderState(ctx: DocxTableContext): { enabled: boolean; active: boolean } {
  if (ctx.wholeTable) {
    const first = ctx.table.firstChild;
    return { enabled: first !== null, active: first?.attrs.repeatHeader === true };
  }
  if (ctx.rect.top !== 0) return { enabled: false, active: false };
  let active = true;
  for (let index = 0; index < ctx.rect.bottom; index += 1) {
    if (ctx.table.child(index)?.attrs.repeatHeader !== true) active = false;
  }
  return { enabled: true, active };
}
