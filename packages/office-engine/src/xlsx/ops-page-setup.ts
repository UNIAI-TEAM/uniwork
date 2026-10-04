// XLSX page-setup op parser (pageSetupStates slot). Split out of ops.ts
// (FIX-926-B); the shared vocabulary lives in ops-shared.ts.
import { PAGE_SETUP_OP_KIND, type XlsxPageSetupFields } from "./page-setup.ts";
import { XlsxOpError, int, str, a1ToRowColumn, parseStructuralTarget, parseStructuralAttributes, MAX_ROWS, MAX_COLS, type Dict, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";
// ── page setup (pageSetupStates slot) ─────────────────────────────────────
//
// Wire shape: { op: "set_page_setup", target: { sheet }, attributes: { ... } }.
// The whole declarative snapshot rides the raw attributes object like the
// structural kinds; the parser is strict (unknown or malformed fields are a
// typed error, never a silent drop) and normalizes to the upstream
// SheetPageSetupState vocabulary (xlsx-page-setup.ts). A field absent from the
// attributes is absent from the op, so the gateway leaves the file's value
// verbatim; a field present with the wrong type or range is refused here.

/** OOXML paper-size codes the gateway/desktop schema accepts (1..118). */
const MAX_PAPER_SIZE = 118;
/** sheetView zoom / page scale percent bound (10..400). */
const MIN_PAGE_SCALE = 10;
const MAX_PAGE_SCALE = 400;
/** Fit-to-page counts are 0 (automatic) .. 1000. */
const MAX_FIT_TO = 1_000;
/** A print-title row span like "1:3" (1-based, ascending). */
const PRINT_TITLES = /^(\d{1,7}):(\d{1,7})$/;

function pageSetupBool(a: Dict, key: string, op: string): boolean | undefined {
  if (a[key] === undefined) return undefined;
  if (typeof a[key] !== "boolean") throw new XlsxOpError(op, "attributes." + key, "boolean required");
  return a[key];
}

function pageSetupInt(a: Dict, key: string, op: string, min: number, max: number): number | undefined {
  if (a[key] === undefined) return undefined;
  const value = int(a[key], op, "attributes." + key);
  if (value < min || value > max) throw new XlsxOpError(op, "attributes." + key, "integer " + min + "-" + max + " required");
  return value;
}

function pageSetupEnum<T extends string>(a: Dict, key: string, op: string, allowed: readonly T[]): T | undefined {
  if (a[key] === undefined) return undefined;
  const value = str(a[key], op, "attributes." + key);
  if (!(allowed as readonly string[]).includes(value)) throw new XlsxOpError(op, "attributes." + key, "one of " + allowed.join(", "));
  return value as T;
}

/** A print area: the A1 grammar the upstream toAbsoluteRange accepts, with the
 *  upstream's 255-character bound. null clears the defined name. */
function pageSetupPrintArea(a: Dict, op: string): string | null | undefined {
  if (a.printArea === undefined) return undefined;
  if (a.printArea === null) return null;
  const value = str(a.printArea, op, "attributes.printArea");
  if (value.length === 0 || value.length > 255 || !/^[$A-Za-z0-9:]+$/.test(value)) {
    throw new XlsxOpError(op, "attributes.printArea", "an A1 range like A1:C10 (or null) required");
  }
  const parts = value.split(":");
  for (const part of parts) a1ToRowColumn(part, op, "attributes.printArea");
  return value;
}

/** Print titles: a row span "1:3" (the only spelling upstream
 *  toAbsoluteRowSpan accepts), or null to clear. */
function pageSetupPrintTitles(a: Dict, op: string): string | null | undefined {
  if (a.printTitles === undefined) return undefined;
  if (a.printTitles === null) return null;
  const value = str(a.printTitles, op, "attributes.printTitles");
  const match = PRINT_TITLES.exec(value);
  const start = match ? Number(match[1]) : 0;
  const end = match ? Number(match[2]) : 0;
  if (!match || start < 1 || start > end || end > MAX_ROWS) {
    throw new XlsxOpError(op, "attributes.printTitles", "a row span like 1:3 (or null) required");
  }
  return value;
}

/** One manual-break array. The upstream sorts and de-dupes; every id here must
 *  be a positive in-grid index. */
function pageSetupBreaks(a: Dict, key: "rowBreaks" | "colBreaks", op: string, max: number): number[] | undefined {
  if (a[key] === undefined) return undefined;
  if (!Array.isArray(a[key]) || a[key].length > 1_023) {
    throw new XlsxOpError(op, "attributes." + key, "at most 1023 break indexes");
  }
  return a[key].map((entry) => {
    const value = int(entry, op, "attributes." + key);
    if (value < 1 || value > max) throw new XlsxOpError(op, "attributes." + key, "break index 1-" + max + " required");
    return value;
  });
}

/** The page-setup attribute vocabulary (the typed op's own fields). An unknown
 *  attribute would be silently dropped by the typed op, so it is refused. */
const PAGE_SETUP_FIELDS: ReadonlySet<string> = new Set([
  "orientation", "paperSize", "scale", "fitToWidth", "fitToHeight", "fitToPage", "margins",
  "printGridlines", "printHeadings", "printArea", "printTitles",
  "frozenRows", "frozenColumns", "rowBreaks", "colBreaks",
]);

export function parseSetPageSetup(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  for (const key of Object.keys(a)) {
    if (!PAGE_SETUP_FIELDS.has(key)) throw new XlsxOpError(op, "attributes." + key, "unknown page-setup field");
  }
  // The frozen pane is one state with two axes: the gateway's
  // applyPageSetupState writes `frozenRows ?? 0`/`frozenColumns ?? 0`, so a
  // lone axis would silently reset the other to 0. Require the pair, matching
  // the upstream workbookPageSetupStateSchema ("both present together").
  const frozenRows = pageSetupInt(a, "frozenRows", op, 0, MAX_ROWS - 1);
  const frozenColumns = pageSetupInt(a, "frozenColumns", op, 0, MAX_COLS - 1);
  if ((frozenRows === undefined) !== (frozenColumns === undefined)) {
    throw new XlsxOpError(op, "attributes.frozenRows", "frozenRows and frozenColumns must be set together");
  }
  const setup: XlsxPageSetupFields = {
    orientation: pageSetupEnum(a, "orientation", op, ["portrait", "landscape"] as const),
    paperSize: pageSetupInt(a, "paperSize", op, 1, MAX_PAPER_SIZE),
    scale: pageSetupInt(a, "scale", op, MIN_PAGE_SCALE, MAX_PAGE_SCALE),
    fitToWidth: pageSetupInt(a, "fitToWidth", op, 0, MAX_FIT_TO),
    fitToHeight: pageSetupInt(a, "fitToHeight", op, 0, MAX_FIT_TO),
    fitToPage: pageSetupBool(a, "fitToPage", op),
    margins: pageSetupEnum(a, "margins", op, ["normal", "wide", "narrow"] as const),
    printGridlines: pageSetupBool(a, "printGridlines", op),
    printHeadings: pageSetupBool(a, "printHeadings", op),
    printArea: pageSetupPrintArea(a, op),
    printTitles: pageSetupPrintTitles(a, op),
    frozenRows,
    frozenColumns,
    rowBreaks: pageSetupBreaks(a, "rowBreaks", op, MAX_ROWS - 1),
    colBreaks: pageSetupBreaks(a, "colBreaks", op, MAX_COLS - 1),
  };
  if (Object.values(setup).every((value) => value === undefined)) {
    throw new XlsxOpError(op, "attributes", "a page-setup op needs at least one setting");
  }
  return [{ kind: PAGE_SETUP_OP_KIND, sheetName, setup }];
}


