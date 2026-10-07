// UNI-952 (D-xlsx): gather one sheet for printing from the live editor.
//   * Text as displayed (number formats applied) comes from the mounted grid
//     (`readRangeValues().display`), which already holds every session edit.
//     Without a grid, the live snapshot's value is formatted here instead.
//   * Styles, merges, row heights and column widths come from the mounted
//     grid when it can say what it paints (collect-live: session edits and
//     conditional-format colours included), else from the renderer host (the
//     render model the grid was loaded from).
//   * Page setup: this session's dialog edits > the file's layout > defaults.
//   * Charts, pictures and shapes come from the visuals layer, measured in
//     the sizes this copy prints with (print-visuals). Without a print area
//     the printed range grows over the boxes they draw (print-extent), as
//     Excel prints a sheet; so do the open bounds of a whole-row/column one.
//   * Each area of a multi-area print area is read with the title rows and
//     columns it repeats, as separate blocks (title rows x the area's columns,
//     the area's rows x title columns, and their corner), so a print area far
//     from its titles reads only the cells that print. The areas print in order.
//   * Reads go in row chunks of about CHUNK_CELLS cells and the run yields to
//     the browser between chunks, so a large sheet does not freeze the page.
import type { XlsxCellScalar, XlsxPageSetupFields, XlsxRenderStyle, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { formatNumberForFit } from "../xlsx-column-autofit";
import { addressParts } from "../xlsx-editor-model";
import { toA1Address } from "../xlsx-render-model-bridge";
import { XlsxLiveLayout, type XlsxPrintGrid } from "./collect-live";
import { MAX_PRINT_CELLS, type XlsxPrintCell, type XlsxPrintSheet } from "./print-copy";
import { drawnExtent } from "./print-extent";
import { resolvePrintSetup, type XlsxPrintRange } from "./print-setup";
import { collectPrintPictures, type XlsxPrintableVisuals } from "./print-visuals";

interface XlsxPrintCollectInput {
  readonly host: XlsxGridHostPort;
  /** The live sheet name and, when the grid knows it, the grid sheet id. */
  readonly sheetName: string;
  readonly sheetId?: string | undefined;
  readonly snapshot: XlsxWorkbookSnapshot | null;
  readonly grid?: XlsxPrintGrid | null | undefined;
  /** This session's unsaved Page Setup dialog edits for the sheet. */
  readonly session?: XlsxPageSetupFields | undefined;
  readonly title: string;
  /** When the copy is printed and the locale its &D / &T codes use. */
  readonly now?: Date | undefined;
  readonly locale?: string | undefined;
  /** The visuals layer's getPrintableVisuals (absent = no visuals print). */
  readonly visuals?: XlsxPrintableVisuals | null | undefined;
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

const pad = (value: number): string => String(value).padStart(2, "0");

/** An Excel serial as ISO "yyyy-mm-dd" (plus "hh:mm" when it has a time).
 *  The no-grid fallback only: the grid's own display text is exact. */
function serialDate(serial: number, date1904: boolean): string {
  // 1900 system: day 1 = 1900-01-01 and Excel's phantom 1900-02-29 (day 60).
  const days = date1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(days * 86_400_000 / 60_000) * 60_000);
  if (Number.isNaN(date.getTime())) return String(serial);
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return serial % 1 === 0 ? day : `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** Display text without a grid: the value through its number format. */
function fallbackText(value: XlsxCellScalar | undefined, style: XlsxRenderStyle | undefined, date1904: boolean): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    const format = style?.numberFormat;
    return format && isDateFormat(format) ? serialDate(value, date1904) : formatNumberForFit(value, format);
  }
  return value;
}

type TitleSpan = { readonly start: number; readonly end: number };

/** About this many cells per read; the run yields to the browser between. */
const CHUNK_CELLS = 20_000;
const yieldToBrowser = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
const cellCount = (range: XlsxPrintRange): number => (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);

/** The blocks one area prints from: the area, then the title rows and
 *  columns it repeats (and their corner) where they lie outside it. */
function blocksFor(area: XlsxPrintRange, titleRows: TitleSpan | null, titleColumns: TitleSpan | null): XlsxPrintRange[] {
  const rowsOutside = titleRows !== null && (titleRows.start < area.startRow || titleRows.end > area.endRow);
  const columnsOutside = titleColumns !== null && (titleColumns.start < area.startColumn || titleColumns.end > area.endColumn);
  const blocks = [area];
  if (rowsOutside) blocks.push({ startRow: titleRows.start, endRow: titleRows.end, startColumn: area.startColumn, endColumn: area.endColumn });
  if (columnsOutside) blocks.push({ startRow: area.startRow, endRow: area.endRow, startColumn: titleColumns.start, endColumn: titleColumns.end });
  if (rowsOutside && columnsOutside) blocks.push({ startRow: titleRows.start, endRow: titleRows.end, startColumn: titleColumns.start, endColumn: titleColumns.end });
  return blocks;
}

/** A block cut into row chunks of about CHUNK_CELLS cells. */
function chunksOf(range: XlsxPrintRange): XlsxPrintRange[] {
  const rowsPerChunk = Math.max(1, Math.floor(CHUNK_CELLS / (range.endColumn - range.startColumn + 1)));
  const chunks: XlsxPrintRange[] = [];
  for (let start = range.startRow; start <= range.endRow; start += rowsPerChunk) {
    chunks.push({ ...range, startRow: start, endRow: Math.min(range.endRow, start + rowsPerChunk - 1) });
  }
  return chunks;
}

/** The file's column spans over columns start..end, in points. */
function setFileColumns(into: Map<number, { width?: number; hidden?: boolean }>, spans: readonly { startColumn: number; endColumn: number; width?: number | undefined; hidden?: boolean | undefined }[], start: number, end: number): void {
  for (const span of spans) {
    for (let column = Math.max(span.startColumn, start); column <= Math.min(span.endColumn, end); column += 1) {
      into.set(column, {
        ...(span.width === undefined ? {} : { width: columnPoints(span.width) }),
        ...(span.hidden ? { hidden: true } : {}),
      });
    }
  }
}

/** The used range: the file's dimension, grown by any live cell. */
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

  const gridSheetId = input.sheetId ?? fileSheet.id;
  const sheetIds = [...new Set([gridSheetId, fileSheet.id])];
  const defaultChars = fileSheet.defaultColumnWidth ?? Math.trunc((((fileSheet.baseColumnWidth ?? 8) * MDW + 5) / MDW) * 256) / 256;
  const defaultColumnWidth = columnPoints(defaultChars);
  const defaultRowHeight = fileSheet.defaultRowHeight ?? 15;
  const cellsUsed = usedRange(fileSheet.rowCount, fileSheet.columnCount, liveSheet?.cells);
  // Sizes as the copy prints them: the model's rows and the file's columns,
  // overridden by what the grid paints (one column / one row wide reads).
  const drawn = input.visuals ? await drawnExtent({
    visuals: input.visuals,
    sheetIds,
    used: cellsUsed,
    defaultRowHeight,
    defaultColumnWidth,
    readRows: async (startRow, endRow) => {
      const range = { startRow, endRow, startColumn: 0, endColumn: 0 };
      const sizes = new Map<number, { height?: number; hidden?: boolean }>();
      for (const row of (await host.readRange({ sessionId: file.sessionId, sheetId: fileSheet.id, range })).rows) {
        sizes.set(row.row, { ...(row.height === undefined ? {} : { height: row.height }), ...(row.hidden ? { hidden: true } : {}) });
      }
      const strip = new XlsxLiveLayout([]);
      strip.add(range, grid?.readPrintRange?.(gridSheetId, range));
      for (const [row, size] of strip.rows) sizes.set(row, size);
      return sizes;
    },
    readColumns: async (startColumn, endColumn) => {
      const range = { startRow: 0, endRow: 0, startColumn, endColumn };
      const sizes = new Map<number, { width?: number; hidden?: boolean }>();
      setFileColumns(sizes, fileSheet.columnWidths, startColumn, endColumn);
      const strip = new XlsxLiveLayout([]);
      strip.add(range, grid?.readPrintRange?.(gridSheetId, range));
      for (const [column, size] of strip.columns) sizes.set(column, size);
      return sizes;
    },
  }) : null;
  const used = drawn ? { ...cellsUsed, endRow: Math.max(cellsUsed.endRow, drawn.endRow), endColumn: Math.max(cellsUsed.endColumn, drawn.endColumn) } : cellsUsed;
  const setup = resolvePrintSetup({ file: fileSheet.pageSetup, session: input.session, definedNames: file.definedNames, sheetIndex: index, used });
  const areas = setup.printAreas ?? [used];
  const reads = areas.flatMap((area) => blocksFor(area, setup.titleRows, setup.titleColumns));
  if (reads.reduce((total, read) => total + cellCount(read), 0) > MAX_PRINT_CELLS) return { ok: false, reason: "print_too_large" };

  const live = new XlsxLiveLayout(file.styles);
  const cells = new Map<string, XlsxPrintCell>();
  const rows = new Map<number, { height?: number; hidden?: boolean }>();
  const merges = new Map<string, XlsxPrintRange>();
  let liveRead = true;
  const chunks = reads.flatMap(chunksOf);
  for (const [position, read] of chunks.entries()) {
    if (position > 0) await yieldToBrowser();
    const model = await host.readRange({ sessionId: file.sessionId, sheetId: fileSheet.id, range: read });
    const gridRead = grid?.readRangeValues?.(gridSheetId, read) ?? null;
    const display = gridRead?.display ?? null;
    liveRead = live.add(read, grid?.readPrintRange?.(gridSheetId, read)) && liveRead;
    const styleOf = new Map(model.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
    for (let row = read.startRow; row <= read.endRow; row += 1) {
      for (let column = read.startColumn; column <= read.endColumn; column += 1) {
        const at = `${row}:${column}`;
        const modelCell = styleOf.get(at);
        const liveCell = liveSheet ? liveSheet.cells[toA1Address(row, column)] : undefined;
        // The grid's computed value types the cell (a formula's cached value is
        // null in the session snapshot); without one, the file's cached value
        // stands in for a snapshot formula that has none.
        const computed = gridRead?.values[row - read.startRow]?.[column - read.startColumn];
        const value = computed !== undefined ? computed
          : liveSheet ? (liveCell?.formula !== undefined && liveCell.value === null ? modelCell?.value : liveCell?.value) : modelCell?.value;
        const painted = live.styleAt(row, column);
        const styleIndex = painted === undefined ? modelCell?.styleIndex : (painted ?? undefined);
        const style = styleIndex === undefined ? undefined : live.styles[styleIndex];
        const shown = display?.[row - read.startRow]?.[column - read.startColumn];
        const text = typeof shown === "string" ? shown : fallbackText(value, style, file.date1904 === true);
        if (text === "" && styleIndex === undefined) continue;
        cells.set(at, { text, kind: kindOf(value), ...(styleIndex === undefined ? {} : { styleIndex }) });
      }
    }
    for (const row of model.rows) {
      rows.set(row.row, { ...(row.height === undefined ? {} : { height: row.height }), ...(row.hidden ? { hidden: true } : {}) });
    }
    for (const merge of model.merges) merges.set(`${merge.startRow}:${merge.endRow}:${merge.startColumn}:${merge.endColumn}`, merge);
  }

  const columns = new Map<number, { width?: number; hidden?: boolean }>();
  for (const read of reads) setFileColumns(columns, fileSheet.columnWidths, read.startColumn, read.endColumn);
  // What the grid paints wins over the file for every row/column it read.
  for (const [row, size] of live.rows) rows.set(row, size);
  for (const [column, size] of live.columns) columns.set(column, size);
  const now = input.now ?? new Date();
  const pictures = input.visuals
    ? collectPrintPictures({
      source: input.visuals,
      sheetIds,
      columnWidth: (column) => (columns.get(column)?.hidden ? 0 : (columns.get(column)?.width ?? defaultColumnWidth)),
      rowHeight: (row) => (rows.get(row)?.hidden ? 0 : (rows.get(row)?.height ?? defaultRowHeight)),
    })
    : [];

  return {
    ok: true,
    sheet: {
      title: input.title,
      setup,
      areas,
      cells,
      styles: live.styles,
      columns,
      rows,
      defaultColumnWidth,
      defaultRowHeight,
      merges: liveRead ? live.merges : [...merges.values()],
      defaultFont: { family: file.normalFontName, size: file.styles[0]?.fontSize },
      rightToLeft: fileSheet.rightToLeft,
      ...(live.marks.size > 0 ? { marks: live.marks } : {}),
      ...(pictures.length > 0 ? { pictures } : {}),
      headerContext: {
        sheetName: input.sheetName,
        fileName: file.name,
        date: new Intl.DateTimeFormat(input.locale, { dateStyle: "short" }).format(now),
        time: new Intl.DateTimeFormat(input.locale, { timeStyle: "short" }).format(now),
      },
    },
  };
}
