/** Go-to parsing and the view-command payloads it fires. The selection rides
 *  the allowlisted `sheet.operation.set-selections` view command and the
 *  reveal uses `sheet.command.scroll-to-cell`: a toolbar group only reaches
 *  the renderer through the commands port, never the grid handle. */

export const XLSX_SET_SELECTIONS_COMMAND = "sheet.operation.set-selections";
export const XLSX_SCROLL_TO_CELL_COMMAND = "sheet.command.scroll-to-cell";

export interface XlsxGoToRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const CELL_REFERENCE = /^([A-Z]{1,3})(\d{1,7})$/;

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseCell(input: string): { row: number; column: number } | null {
  const match = CELL_REFERENCE.exec(input);
  if (!match) return null;
  const column = columnIndex(match[1]!);
  const row = Number.parseInt(match[2]!, 10) - 1;
  if (row < 0 || row >= MAX_ROWS || column < 0 || column >= MAX_COLUMNS) return null;
  return { row, column };
}

/** Parse an A1 reference or range (`B5`, `a1:c10`, `$B$5`, `C10:A1`) into a
 *  sheet-relative rectangle. Sheet-qualified input (`Data!A1`) and whole
 *  row/column references (`1:1`, `A:A`) are deliberately not accepted: the
 *  control acts on the active sheet, and the message covers what is. Returns
 *  null for anything invalid. */
export function parseA1Reference(input: string): XlsxGoToRange | null {
  const cleaned = input.trim().toUpperCase().replace(/\$/g, "");
  if (!cleaned || cleaned.includes("!")) return null;
  const parts = cleaned.split(":");
  if (parts.length > 2) return null;
  const first = parseCell(parts[0]!);
  if (!first) return null;
  const second = parts.length === 2 ? parseCell(parts[1]!) : first;
  if (!second) return null;
  return {
    startRow: Math.min(first.row, second.row),
    endRow: Math.max(first.row, second.row),
    startColumn: Math.min(first.column, second.column),
    endColumn: Math.max(first.column, second.column),
  };
}

/** The `sheet.operation.set-selections` payload: the range, its top-left cell
 *  as the primary, and the neutral style `sheet.command.select-range` uses. */
export function selectionCommandParams(range: XlsxGoToRange): {
  selections: Array<{
    range: XlsxGoToRange;
    primary: {
      startRow: number; startColumn: number; endRow: number; endColumn: number;
      actualRow: number; actualColumn: number; rangeType: number;
      isMerged: boolean; isMergedMainCell: boolean;
    };
    style: null;
  }>;
} {
  return {
    selections: [{
      range,
      primary: {
        startRow: range.startRow,
        startColumn: range.startColumn,
        endRow: range.startRow,
        endColumn: range.startColumn,
        actualRow: range.startRow,
        actualColumn: range.startColumn,
        rangeType: 0,
        isMerged: false,
        isMergedMainCell: false,
      },
      style: null,
    }],
  };
}

export function scrollCommandParams(range: XlsxGoToRange): {
  range: XlsxGoToRange;
  forceTop: boolean;
  forceLeft: boolean;
} {
  return { range, forceTop: true, forceLeft: true };
}
