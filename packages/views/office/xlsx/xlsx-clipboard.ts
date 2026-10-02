import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import type { XlsxSelection, XlsxWorkbookSnapshot } from "./types";
import { addressParts, cellText, columnLabel } from "./xlsx-editor-model";

export function clipboardCells(selection: XlsxSelection, text: string) {
  const start = addressParts(selection.address);
  if (!start) throw new Error("xlsx_clipboard_invalid_selection");
  const rows = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").map((row) => row.split("\t"));
  const cells = rows.flatMap((values, row) => values.map((value, column) => ({ row: start.row + row, column: start.column + column, text: value })));
  if (cells.length > ENGINE_LIMITS.max_edit_ops || cells.some((cell) => cell.row >= 1_048_576 || cell.column >= 16_384)) throw new Error("xlsx_clipboard_outside_bounds");
  return cells;
}

export function selectionClipboardText(snapshot: XlsxWorkbookSnapshot | null, selection: XlsxSelection): string {
  const start = addressParts(selection.address);
  const end = addressParts(selection.endAddress ?? selection.address);
  const sheet = snapshot?.sheets.find((candidate) => candidate.name === selection.sheet);
  if (!start || !end || !sheet) return "";
  const count = (end.row - start.row + 1) * (end.column - start.column + 1);
  if (count < 1 || count > ENGINE_LIMITS.max_edit_ops) throw new Error("xlsx_clipboard_outside_bounds");
  return Array.from({ length: end.row - start.row + 1 }, (_, row) => Array.from({ length: end.column - start.column + 1 }, (_, column) => cellText(sheet.cells[`${columnLabel(start.column + column)}${start.row + row + 1}`])).join("\t")).join("\n");
}
