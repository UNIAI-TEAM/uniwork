// UNI-952 (D-xlsx): the page setup one print run applies to one sheet.
// Precedence, per field: the unsaved Page Setup dialog edits of this session,
// then the file's own page layout (render model), then the defaults below.
// Print area and print titles come from the same layers: a session edit, then
// the sheet-scoped `_xlnm.Print_Area` / `_xlnm.Print_Titles` defined names.
import type { XlsxPageSetupFields, XlsxRenderPageMargins, XlsxRenderPageSetup } from "@uniwork/office-engine/xlsx";

/** A 0-based, inclusive cell range. */
export interface XlsxPrintRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

/** Everything the copy builder needs to lay out pages. Lengths in inches. */
export interface XlsxResolvedPrintSetup {
  readonly orientation: "portrait" | "landscape";
  /** Physical paper size in inches, already oriented. */
  readonly paper: { readonly width: number; readonly height: number };
  readonly margins: XlsxRenderPageMargins;
  /** Fixed scale in percent (10-400) when fit-to-page is off. */
  readonly scale: number;
  /** Fit-to-page: pages wide / tall (0 = no limit on that axis), or null. */
  readonly fit: { readonly width: number; readonly height: number } | null;
  readonly gridlines: boolean;
  readonly headings: boolean;
  readonly horizontalCentered: boolean;
  readonly verticalCentered: boolean;
  readonly printArea: XlsxPrintRange | null;
  /** 0-based inclusive rows repeated at the top of every page. */
  readonly titleRows: { readonly start: number; readonly end: number } | null;
  readonly rowBreaks: readonly number[];
  readonly colBreaks: readonly number[];
}

/** OOXML ST_PaperSize codes we know, in inches (portrait). Unknown -> A4. */
const PAPER_INCHES: Readonly<Record<number, readonly [number, number]>> = {
  1: [8.5, 11],
  3: [11, 17],
  5: [8.5, 14],
  8: [297 / 25.4, 420 / 25.4],
  9: [210 / 25.4, 297 / 25.4],
  11: [148 / 25.4, 210 / 25.4],
};
const A4 = 9;

/** Excel's margin presets (the dialog's normal / wide / narrow). */
const MARGIN_PRESETS: Readonly<Record<"normal" | "wide" | "narrow", XlsxRenderPageMargins>> = {
  normal: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 },
  wide: { left: 1, right: 1, top: 1, bottom: 1 },
  narrow: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75 },
};

/** One workbook defined name, as the renderer host carries it. */
export interface XlsxPrintDefinedName {
  readonly name: string;
  readonly formula: string;
  readonly sheetIndex?: number | undefined;
}

function columnIndex(letters: string): number {
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column - 1;
}

/** Strip a leading sheet qualifier (`'My sheet'!` / `Data!`) and `$` signs. */
function bareReference(text: string): string {
  const trimmed = text.trim();
  const bang = trimmed.lastIndexOf("!");
  return (bang === -1 ? trimmed : trimmed.slice(bang + 1)).replace(/\$/g, "");
}

/** "A1:D20" / "B3" / "A:C" / "2:9" (optionally sheet-qualified, absolute) to a
 *  range; whole columns/rows extend to the given used bounds. The first area
 *  of a multi-area reference wins (a second area is not printed). */
export function parsePrintRange(text: string, used: XlsxPrintRange): XlsxPrintRange | null {
  const first = bareReference(text.split(",")[0] ?? "");
  const cells = /^([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?$/.exec(first);
  if (cells) {
    const startColumn = columnIndex(cells[1]!);
    const startRow = Number(cells[2]) - 1;
    const endColumn = cells[3] === undefined ? startColumn : columnIndex(cells[3]);
    const endRow = cells[4] === undefined ? startRow : Number(cells[4]) - 1;
    if (startRow < 0 || endRow < 0) return null;
    return {
      startRow: Math.min(startRow, endRow),
      endRow: Math.max(startRow, endRow),
      startColumn: Math.min(startColumn, endColumn),
      endColumn: Math.max(startColumn, endColumn),
    };
  }
  const columns = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(first);
  if (columns) {
    const a = columnIndex(columns[1]!);
    const b = columnIndex(columns[2]!);
    return { startRow: used.startRow, endRow: used.endRow, startColumn: Math.min(a, b), endColumn: Math.max(a, b) };
  }
  const rows = parseTitleRows(first);
  return rows ? { startRow: rows.start, endRow: rows.end, startColumn: used.startColumn, endColumn: used.endColumn } : null;
}

/** "1:2" / "$1:$2" (optionally sheet-qualified, maybe beside a column span)
 *  to 0-based inclusive rows; null when no row span is present. */
export function parseTitleRows(text: string): { start: number; end: number } | null {
  for (const part of text.split(",")) {
    const match = /^(\d{1,7}):(\d{1,7})$/.exec(bareReference(part));
    if (!match) continue;
    const start = Number(match[1]) - 1;
    const end = Number(match[2]) - 1;
    if (start >= 0 && end >= start) return { start, end };
  }
  return null;
}

function definedNameFor(names: readonly XlsxPrintDefinedName[], name: string, sheetIndex: number): string | undefined {
  return names.find((entry) => entry.sheetIndex === sheetIndex && entry.name.toLowerCase() === name.toLowerCase())?.formula;
}

interface XlsxPrintSetupInput {
  /** The file's page layout (render model); absent when it sets none. */
  readonly file?: XlsxRenderPageSetup | undefined;
  /** This session's unsaved Page Setup dialog edits, folded field-wise. */
  readonly session?: XlsxPageSetupFields | undefined;
  readonly definedNames?: readonly XlsxPrintDefinedName[] | undefined;
  /** The sheet's 0-based workbook position (defined-name scope). */
  readonly sheetIndex: number;
  /** The used range, for whole-row/column references. */
  readonly used: XlsxPrintRange;
}

const pick = <T,>(...values: readonly (T | undefined)[]): T | undefined => values.find((value) => value !== undefined);

/** Resolve the effective page setup (see the module comment for precedence). */
export function resolvePrintSetup(input: XlsxPrintSetupInput): XlsxResolvedPrintSetup {
  const file = input.file ?? {};
  const session = input.session ?? {};
  const orientation = pick(session.orientation, file.orientation) ?? "portrait";
  const paperCode = pick(session.paperSize, file.paperSize) ?? A4;
  const [short, long] = PAPER_INCHES[paperCode] ?? PAPER_INCHES[A4]!;
  const paper = orientation === "landscape" ? { width: long, height: short } : { width: short, height: long };
  const margins = session.margins !== undefined ? MARGIN_PRESETS[session.margins] : (file.margins ?? MARGIN_PRESETS.normal);
  const fitToPage = pick(session.fitToPage, file.fitToPage) ?? false;
  const fit = fitToPage
    ? { width: pick(session.fitToWidth, file.fitToWidth) ?? 1, height: pick(session.fitToHeight, file.fitToHeight) ?? 1 }
    : null;
  const names = input.definedNames ?? [];

  const areaText = session.printArea === undefined ? definedNameFor(names, "_xlnm.Print_Area", input.sheetIndex) : session.printArea;
  const titleText = session.printTitles === undefined ? definedNameFor(names, "_xlnm.Print_Titles", input.sheetIndex) : session.printTitles;

  return {
    orientation,
    paper,
    margins,
    scale: pick(session.scale, file.scale) ?? 100,
    fit,
    gridlines: pick(session.printGridlines, file.printGridlines) ?? false,
    headings: pick(session.printHeadings, file.printHeadings) ?? false,
    horizontalCentered: file.horizontalCentered ?? false,
    verticalCentered: file.verticalCentered ?? false,
    printArea: areaText ? parsePrintRange(areaText, input.used) : null,
    titleRows: titleText ? parseTitleRows(titleText) : null,
    rowBreaks: pick(session.rowBreaks, file.rowBreaks) ?? [],
    colBreaks: pick(session.colBreaks, file.colBreaks) ?? [],
  };
}
