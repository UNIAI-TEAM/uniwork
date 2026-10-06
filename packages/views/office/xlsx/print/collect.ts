// UNI-952 (D-xlsx): gather one sheet for printing from the live editor.
//   * Text as displayed (number formats applied) comes from the mounted grid
//     (`readRangeValues().display`), which already holds every session edit.
//     Without a grid, the live snapshot's value is formatted here instead.
//   * Styles, merges, row heights and column widths come from the renderer
//     host (the render model the grid was loaded from).
//   * Page setup: this session's dialog edits > the file's layout > defaults.
import type { XlsxCellScalar, XlsxPageSetupFields, XlsxRenderStyle, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxVisualsGrid } from "../visuals/use-xlsx-visuals";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { formatNumberForFit } from "../xlsx-column-autofit";
import { addressParts } from "../xlsx-editor-model";
import { toA1Address } from "../xlsx-render-model-bridge";
import { MAX_PRINT_CELLS, type XlsxPrintCell, type XlsxPrintSheet } from "./print-copy";
import { resolvePrintSetup, type XlsxPrintRange } from "./print-setup";

interface XlsxPrintCollectInput {
  readonly host: XlsxGridHostPort;
  /** The live sheet name and, when the grid knows it, the grid sheet id. */
  readonly sheetName: string;
  readonly sheetId?: string | undefined;
  readonly snapshot: XlsxWorkbookSnapshot | null;
  readonly grid?: XlsxVisualsGrid | null | undefined;
  /** This session's unsaved Page Setup dialog edits for the sheet. */
  readonly session?: XlsxPageSetupFields | undefined;
  readonly title: string;
}

type XlsxPrintCollectResult =
  | { readonly ok: true; readonly sheet: XlsxPrintSheet }
  | { readonly ok: false; readonly reason: "print_no_sheet" | "print_too_large" };

const ERRORS = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!"]);
/** Excel's maximum digit width at Calibri 11, in pixels. */
const MDW = 7;
const PT_PER_PX = 0.75;

/** OOXML column width (characters) to points, Excel's own rounding. */
function columnPoints(chars: number): number {
  return Math.trunc(((256 * chars + Math.trunc(128 / MDW)) / 256) * MDW) * PT_PER_PX;
}

function kindOf(value: XlsxCellScalar | undefined): XlsxPrintCell["kind"] {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string" && ERRORS.has(value)) return "error";
  return "text";
}

const isDateFormat = (format: string): boolean => /[ymdhs]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]|\./g, "")) && !/general/i.test(format);

/** Display text without a grid: the value through its number format. */
function fallbackText(value: XlsxCellScalar | undefined, style: XlsxRenderStyle | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    const format = style?.numberFormat;
    return format && isDateFormat(format) ? String(value) : formatNumberForFit(value, format);
  }
  return value;
}

/** The used range: the file's dimension, grown by any live cell beyond it. */
function usedRange(rowCount: number, columnCount: number, cells: Readonly<Record<string, { readonly value: XlsxCellScalar }>> | undefined): XlsxPrintRange {
  let endRow = Math.max(0, rowCount - 1);
  let endColumn = Math.max(0, columnCount - 1);
  for (const [address, cell] of Object.entries(cells ?? {})) {
    if (cell.value === null || cell.value === "") continue;
    const parts = addressParts(address);
    if (!parts) continue;
    endRow = Math.max(endRow, parts.row);
    endColumn = Math.max(endColumn, parts.column);
  }
  return { startRow: 0, endRow, startColumn: 0, endColumn };
}

/** Collect the active sheet into the copy builder's input. */
export async function collectXlsxPrintSheet(input: XlsxPrintCollectInput): Promise<XlsxPrintCollectResult> {
  const { host, snapshot, grid } = input;
  const file = host.file;
  const sheetIndex = file.sheets.findIndex((candidate) => candidate.id === input.sheetId);
  const index = sheetIndex !== -1 ? sheetIndex : file.sheets.findIndex((candidate) => candidate.name === input.sheetName);
  const fileSheet = file.sheets[index];
  if (!fileSheet) return { ok: false, reason: "print_no_sheet" };
  const liveSheet = snapshot?.sheets.find((candidate) => candidate.name === input.sheetName) ??
    snapshot?.sheets.find((candidate) => candidate.id === fileSheet.id);

  const used = usedRange(fileSheet.rowCount, fileSheet.columnCount, liveSheet?.cells);
  const setup = resolvePrintSetup({ file: fileSheet.pageSetup, session: input.session, definedNames: file.definedNames, sheetIndex: index, used });
  const range = setup.printArea ?? used;
  // Read the print range plus any title rows above or below it, once.
  const read: XlsxPrintRange = {
    startRow: Math.min(range.startRow, setup.titleRows?.start ?? range.startRow),
    endRow: Math.max(range.endRow, setup.titleRows?.end ?? range.endRow),
    startColumn: range.startColumn,
    endColumn: range.endColumn,
  };
  if ((read.endRow - read.startRow + 1) * (read.endColumn - read.startColumn + 1) > MAX_PRINT_CELLS) {
    return { ok: false, reason: "print_too_large" };
  }

  const model = await host.readRange({ sessionId: file.sessionId, sheetId: fileSheet.id, range: read });
  const display = grid?.readRangeValues?.(input.sheetId ?? fileSheet.id, read)?.display ?? null;
  const styles = file.styles;
  const cells = new Map<string, XlsxPrintCell>();
  const styleOf = new Map(model.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  for (let row = read.startRow; row <= read.endRow; row += 1) {
    for (let column = read.startColumn; column <= read.endColumn; column += 1) {
      const at = `${row}:${column}`;
      const modelCell = styleOf.get(at);
      const live = liveSheet ? liveSheet.cells[toA1Address(row, column)] : undefined;
      const value = liveSheet ? live?.value : modelCell?.value;
      const styleIndex = modelCell?.styleIndex;
      const style = styleIndex === undefined ? undefined : styles[styleIndex];
      const shown = display?.[row - read.startRow]?.[column - read.startColumn];
      const text = typeof shown === "string" ? shown : fallbackText(value, style);
      if (text === "" && styleIndex === undefined) continue;
      cells.set(at, { text, kind: kindOf(value), ...(styleIndex === undefined ? {} : { styleIndex }) });
    }
  }

  const columns = new Map<number, { width?: number; hidden?: boolean }>();
  for (const span of fileSheet.columnWidths) {
    for (let column = Math.max(span.startColumn, read.startColumn); column <= Math.min(span.endColumn, read.endColumn); column += 1) {
      columns.set(column, {
        ...(span.width === undefined ? {} : { width: columnPoints(span.width) }),
        ...(span.hidden ? { hidden: true } : {}),
      });
    }
  }
  const rows = new Map<number, { height?: number; hidden?: boolean }>();
  for (const row of model.rows) {
    rows.set(row.row, { ...(row.height === undefined ? {} : { height: row.height }), ...(row.hidden ? { hidden: true } : {}) });
  }
  const defaultChars = fileSheet.defaultColumnWidth ?? Math.trunc((((fileSheet.baseColumnWidth ?? 8) * MDW + 5) / MDW) * 256) / 256;

  return {
    ok: true,
    sheet: {
      title: input.title,
      setup,
      range,
      cells,
      styles,
      columns,
      rows,
      defaultColumnWidth: columnPoints(defaultChars),
      defaultRowHeight: fileSheet.defaultRowHeight ?? 15,
      merges: model.merges,
      defaultFont: { family: file.normalFontName, size: styles[0]?.fontSize },
      rightToLeft: fileSheet.rightToLeft,
    },
  };
}
