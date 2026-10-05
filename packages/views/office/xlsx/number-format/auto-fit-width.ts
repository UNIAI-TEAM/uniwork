import { fireCommand } from "../fire-command";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { characterWidthToPixels } from "../toolbar/structure-size";
import { formatNumberForFit } from "../xlsx-column-autofit";
import { selectionFormatCells } from "./catalog";

/** The renderer's pinned `set-col-auto-width` is not on the command policy, so
 *  the fit is computed here and applied through the allowlisted, journaled
 *  `set-worksheet-col-width` (the path the Column width box uses). */
const COL_WIDTH_COMMAND = "sheet.command.set-worksheet-col-width";
/** Excel's default column (8.43 chars) in renderer pixels. */
const DEFAULT_COLUMN_PIXELS = characterWidthToPixels(8.43);
const MAX_FIT_PIXELS = characterWidthToPixels(50);
const PADDING_CHARS = 1;
/** A read bound; a bigger selection is not fitted. */
const MAX_FIT_CELLS = 20_000;

interface FitCell {
  readonly row: number;
  readonly column: number;
  readonly value: string | number | boolean | null;
}

/** Pixel width each numeric column needs to show `pattern` in full, only for
 *  columns that exceed the default width and their `floor` (the width the
 *  column opened with), so a column is never shrunk. */
export function fittedColumnPixels(
  cells: readonly FitCell[],
  pattern: string,
  startColumn: number,
  endColumn: number,
  floor: (column: number) => number = () => DEFAULT_COLUMN_PIXELS,
): Map<number, number> {
  const chars = new Map<number, number>();
  for (const { column, value } of cells) {
    if (typeof value !== "number" || !Number.isFinite(value) || column < startColumn || column > endColumn) continue;
    chars.set(column, Math.max(chars.get(column) ?? 0, formatNumberForFit(value, pattern).length));
  }
  const fitted = new Map<number, number>();
  for (const [column, count] of chars) {
    const pixels = Math.min(MAX_FIT_PIXELS, characterWidthToPixels(count + PADDING_CHARS));
    if (pixels > Math.max(DEFAULT_COLUMN_PIXELS, floor(column))) fitted.set(column, pixels);
  }
  return fitted;
}

/** After a ribbon number-format command: widen the selection's columns so the
 *  new text is not shown as "####". Best effort: the host reads the file's
 *  values, a missing host/sheet/values changes nothing. */
export async function autoFitColumnsAfterFormat(context: XlsxToolbarGroupProps, pattern: string): Promise<void> {
  const { host, commands, selection, sheetName, resolveSheetId } = context;
  const formatCells = selectionFormatCells(selection);
  if (!host || !commands || !formatCells || formatCells.length === 0 || formatCells.length > MAX_FIT_CELLS) return;
  const sheetId = sheetName == null ? undefined : (resolveSheetId?.(sheetName) ?? host.file.sheets.find((s) => s.name === sheetName)?.id);
  if (sheetId === undefined) return;
  const rows = formatCells.map((cell) => cell.row);
  const columns = formatCells.map((cell) => cell.column);
  const startRow = Math.min(...rows);
  const endRow = Math.max(...rows);
  const startColumn = Math.min(...columns);
  const endColumn = Math.max(...columns);
  try {
    const result = await host.readRange({
      sessionId: host.file.sessionId,
      sheetId,
      range: { startRow, endRow, startColumn, endColumn },
    });
    // The ribbon cannot read live widths; the width each column opened with
    // (file-stored or seeded by the bridge) is the floor the fit never undercuts.
    const spans = host.file.sheets.find((sheet) => sheet.id === sheetId)?.columnWidths ?? [];
    const opened = (column: number) => {
      const span = spans.find((entry) => entry.width !== undefined && entry.startColumn <= column && column <= entry.endColumn);
      return span?.width === undefined ? 0 : characterWidthToPixels(span.width);
    };
    const fitted = fittedColumnPixels(result?.cells ?? [], pattern, startColumn, endColumn, opened);
    for (const [column, value] of fitted) {
      fireCommand(commands, COL_WIDTH_COMMAND, { value, ranges: [{ startRow, endRow, startColumn: column, endColumn: column }] });
    }
  } catch {
    // Fitting is a courtesy; a failed read leaves the widths as they are.
  }
}

export function moreDecimals(pattern: string): string {
  const base = /^general$/i.test(pattern) ? "0" : pattern;
  if (/\.0+/.test(base)) return base.replace(/(\.0+)/, "$10");
  const last = base.lastIndexOf("0");
  return last < 0 ? base : `${base.slice(0, last + 1)}.0${base.slice(last + 1)}`;
}
