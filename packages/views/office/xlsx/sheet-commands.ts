// B3 sheet operations: the pinned Univer command ids the sheet-tab strip
// wires (allowlisted in the renderer command policy with per-param
// validation) and the fallback envelope ops for hosts without a mounted grid.
// Tab colour has no command here: the vendored gateway has no tabColor write
// path, so the strip shows existing colours read-only.

export const XLSX_INSERT_SHEET_COMMAND = "sheet.command.insert-sheet";
export const XLSX_COPY_SHEET_COMMAND = "sheet.command.copy-sheet";
export const XLSX_REMOVE_SHEET_COMMAND = "sheet.command.remove-sheet";
export const XLSX_RENAME_SHEET_COMMAND = "sheet.command.set-worksheet-name";
export const XLSX_ORDER_SHEET_COMMAND = "sheet.command.set-worksheet-order";
export const XLSX_HIDE_SHEET_COMMAND = "sheet.command.set-worksheet-hidden";
export const XLSX_SHOW_SHEET_COMMAND = "sheet.command.set-worksheet-show";

/** One user action the sheet-tab strip emits. Names are final (the strip
 *  computes them, i18n included); `index` is the 0-based destination in the
 *  current tab order. */
export type XlsxSheetTabAction =
  | { kind: "add"; name: string }
  | { kind: "duplicate"; sheet: string; name: string }
  | { kind: "rename"; sheet: string; newName: string }
  | { kind: "remove"; sheet: string }
  | { kind: "move"; sheet: string; index: number }
  | { kind: "set-hidden"; sheet: string; hidden: boolean };

/** The envelope op an action maps to on a host without a mounted grid (the
 *  runtime snapshot applies it; a host with the grid rides the pinned Univer
 *  command instead, and the command's mutation is captured into the same
 *  op). */
export function sheetActionOperation(action: XlsxSheetTabAction): Record<string, unknown> {
  switch (action.kind) {
    case "add":
      return { op: "add_sheet", attributes: { name: action.name } };
    case "duplicate":
      return { op: "duplicate_sheet", target: { sheet: action.sheet }, attributes: { name: action.name } };
    case "rename":
      return { op: "rename_sheet", target: { sheet: action.sheet }, attributes: { newName: action.newName } };
    case "remove":
      return { op: "remove_sheet", target: { sheet: action.sheet } };
    case "move":
      return { op: "reorder_sheet", target: { sheet: action.sheet }, attributes: { index: action.index } };
    case "set-hidden":
      return { op: "set_sheet_hidden", target: { sheet: action.sheet }, attributes: { hidden: action.hidden } };
  }
}
