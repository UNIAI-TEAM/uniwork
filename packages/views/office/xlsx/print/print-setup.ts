// UNI-952 (D-xlsx): the page setup one print run applies to one sheet.
// Precedence, per field: the unsaved Page Setup dialog edits of this session,
// then the file's own page layout (render model), then the defaults below.
// Print area and print titles come from the same layers: a session edit, then
// the sheet-scoped `_xlnm.Print_Area` / `_xlnm.Print_Titles` defined names.
// A print area may hold several areas ("A1:B5,D1:E5"); each prints on pages
// of its own, in order. Print titles may name rows ("$1:$2"), columns
// ("$A:$A") or both. Header/footer text comes from the file only.
import type { XlsxPageSetupFields, XlsxRenderHeaderFooter, XlsxRenderPageMargins, XlsxRenderPageSetup } from "@uniwork/office-engine/xlsx";

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
  /** The print area's areas in print order; null = the used range. */
  readonly printAreas: readonly XlsxPrintRange[] | null;
  /** 0-based inclusive rows repeated at the top of every page. */
  readonly titleRows: { readonly start: number; readonly end: number } | null;
  /** 0-based inclusive columns repeated at the left of every page. */
  readonly titleColumns: { readonly start: number; readonly end: number } | null;
  readonly headerFooter: XlsxRenderHeaderFooter | null;
  readonly rowBreaks: readonly number[];
  readonly colBreaks: readonly number[];
}

const mm = (width: number, height: number): readonly [number, number] => [width / 25.4, height / 25.4];

/** ECMA-376 ST_PaperSize codes 1-68 plus the Windows DMPAPER codes Excel
 *  also writes for A6 (70) and JIS B6 (88), in inches, short side first
 *  (orientation turns them). "Transverse" codes are the same sheet fed the
 *  other way. Unknown -> A4. */
const PAPER_INCHES: Readonly<Record<number, readonly [number, number]>> = {
  1: [8.5, 11], 2: [8.5, 11], 3: [11, 17], 4: [11, 17], 5: [8.5, 14], 6: [5.5, 8.5], 7: [7.25, 10.5],
  8: mm(297, 420), 9: mm(210, 297), 10: mm(210, 297), 11: mm(148, 210), 12: mm(257, 364), 13: mm(182, 257),
  14: [8.5, 13], 15: mm(215, 275), 16: [10, 14], 17: [11, 17], 18: [8.5, 11],
  19: [3.875, 8.875], 20: [4.125, 9.5], 21: [4.5, 10.375], 22: [4.75, 11], 23: [5, 11.5],
  24: [17, 22], 25: [22, 34], 26: [34, 44],
  27: mm(110, 220), 28: mm(162, 229), 29: mm(324, 458), 30: mm(229, 324), 31: mm(114, 162), 32: mm(114, 229),
  33: mm(250, 353), 34: mm(176, 250), 35: mm(125, 176), 36: mm(110, 230), 37: [3.875, 7.5], 38: [3.625, 6.5],
  39: [11, 14.875], 40: [8.5, 12], 41: [8.5, 13], 42: mm(250, 353), 43: mm(100, 148), 44: [9, 11], 45: [10, 11],
  46: [11, 15], 47: mm(220, 220), 50: [9.275, 12], 51: [9.275, 15], 52: [11.69, 18], 53: mm(236, 322),
  54: [8.275, 11], 55: mm(210, 297), 56: [9.275, 12], 57: mm(227, 356), 58: mm(305, 487), 59: [8.5, 12.69],
  60: mm(210, 330), 61: mm(148, 210), 62: mm(182, 257), 63: mm(322, 445), 64: mm(174, 235), 65: mm(201, 276),
  66: mm(420, 594), 67: mm(297, 420), 68: mm(322, 445), 70: mm(105, 148), 88: mm(128, 182),
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

/** Every area of a print area ("A1:B5,'My sheet'!$D$1:$E$5"), in order;
 *  areas that do not parse are skipped. Null when none parses. */
function parsePrintAreas(text: string, used: XlsxPrintRange): XlsxPrintRange[] | null {
  const areas = text.split(",").map((part) => parsePrintRange(part, used)).filter((area): area is XlsxPrintRange => area !== null);
  return areas.length === 0 ? null : areas;
}

/** "A1:D20" / "B3" / "A:C" / "2:9" (optionally sheet-qualified, absolute) to a
 *  range; whole columns/rows extend to the given used bounds. Only the first
 *  area of a multi-area reference is read (parsePrintAreas reads them all). */
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

/** "$A:$B" (optionally sheet-qualified, maybe beside a row span) to 0-based
 *  inclusive columns; null when no column span is present. */
function parseTitleColumns(text: string): { start: number; end: number } | null {
  for (const part of text.split(",")) {
    const match = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(bareReference(part));
    if (!match) continue;
    const start = columnIndex(match[1]!);
    const end = columnIndex(match[2]!);
    return { start: Math.min(start, end), end: Math.max(start, end) };
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
    printAreas: areaText ? parsePrintAreas(areaText, input.used) : null,
    titleRows: titleText ? parseTitleRows(titleText) : null,
    titleColumns: titleText ? parseTitleColumns(titleText) : null,
    headerFooter: file.headerFooter ?? null,
    rowBreaks: pick(session.rowBreaks, file.rowBreaks) ?? [],
    colBreaks: pick(session.colBreaks, file.colBreaks) ?? [],
  };
}
