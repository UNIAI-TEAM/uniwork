import { toA1Address } from "./xlsx-render-model-bridge";

/** Serializable user edits emitted by the streamed grid, including undo. */
export interface XlsxGridCellEdit {
  sheetId: string;
  row: number;
  column: number;
  writeValue: boolean;
  value: string | number | boolean | null;
  formula?: string;
  style?: Record<string, unknown>;
  styleReset?: boolean;
}

/** The envelope target a cell operation addresses: the sheet name (not the
 *  grid's sheet id) and an A1 address. */
export interface XlsxCellOperationTarget {
  sheet: string;
  cell: string;
}

/** The G2 cell-edit vocabulary: set_cell carries content/style, clear_cell
 *  removes the stored cell. */
export interface CellOperation {
  op: "set_cell" | "clear_cell";
  target: XlsxCellOperationTarget;
  attributes?: { value?: XlsxGridCellEdit["value"]; formula?: string; styleReset?: boolean };
  style?: Record<string, unknown>;
}

/** Every envelope operation a journal edit maps to. Today the cell ops are
 *  the whole vocabulary; a later op kind adds its union member here and one
 *  XLSX_JOURNAL_OP_MAPPINGS entry — rendererEditsToOperations itself does not
 *  change. */
export type XlsxJournalOperation = CellOperation;

/** One named journal-edit → op-kind mapping. Entries are tested in table
 *  order and the first match wins, so a later op kind inserts its entry
 *  before the terminal set_cell fallback. */
export interface XlsxJournalOpMapping {
  readonly op: XlsxJournalOperation["op"];
  matches(edit: XlsxGridCellEdit): boolean;
  build(edit: XlsxGridCellEdit, target: XlsxCellOperationTarget): XlsxJournalOperation;
}

/** A clear is a writeValue edit with no content and no style — the one shape
 *  that must not be written as an empty set_cell. */
function isClearEdit(edit: XlsxGridCellEdit): boolean {
  return edit.writeValue && edit.value === null && edit.formula === undefined && edit.style === undefined && !edit.styleReset;
}

/** Journal-edit → op-kind table, in match order. */
export const XLSX_JOURNAL_OP_MAPPINGS: readonly XlsxJournalOpMapping[] = [
  {
    op: "clear_cell",
    matches: isClearEdit,
    build: (_edit, target) => ({ op: "clear_cell", target }),
  },
  {
    op: "set_cell",
    matches: () => true,
    build: (edit, target) => {
      const attributes: NonNullable<CellOperation["attributes"]> = {
        ...(edit.writeValue ? edit.formula === undefined ? { value: edit.value } : { formula: edit.formula } : {}),
        ...(edit.styleReset === undefined ? {} : { styleReset: edit.styleReset }),
      };
      return {
        op: "set_cell",
        target,
        ...(Object.keys(attributes).length ? { attributes } : {}),
        ...(edit.style === undefined ? {} : { style: structuredClone(edit.style) }),
      };
    },
  },
];

/** Keep the G2 vocabulary: a style-only edit must never overwrite a value. */
export function rendererEditsToOperations(
  sheets: readonly { id: string; name: string }[],
  edits: readonly XlsxGridCellEdit[],
): XlsxJournalOperation[] {
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  return edits.map((edit) => {
    const sheet = names.get(edit.sheetId);
    if (!sheet) throw new Error("xlsx_edit_unknown_sheet");
    if (!Number.isSafeInteger(edit.row) || !Number.isSafeInteger(edit.column) || edit.row < 0 || edit.row >= 1_048_576 || edit.column < 0 || edit.column >= 16_384) throw new Error("xlsx_edit_outside_grid");
    const target = { sheet, cell: toA1Address(edit.row, edit.column) };
    const mapping = XLSX_JOURNAL_OP_MAPPINGS.find((entry) => entry.matches(edit));
    if (!mapping) throw new Error("xlsx_edit_unmapped");
    return mapping.build(edit, target);
  });
}
