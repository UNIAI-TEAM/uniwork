// XLSX page setup (C2, UNI-926): the declarative whole-sheet page-layout
// snapshot. The vendored gateway's `applyPageSetupState` merges each present
// field into the worksheet's <printOptions>/<pageMargins>/<pageSetup> (and the
// sheetView display attributes), and `applyPrintAreas` maintains the
// `_xlnm.Print_Area` / `_xlnm.Print_Titles` defined names in workbook.xml. One
// op kind, `set_page_setup`, rides the `pageSetupStates` argument: it carries
// only the fields one edit changed, and the session model folds it per sheet
// field-wise, last write per field wins (a filter-style declarative snapshot).
// This module holds the typed op, the field grammar and the fold; the wire
// parser lives in ops.ts (it needs the shared target/attributes helpers).
import type { XlsxEditOp } from "./ops.ts";

/** The page-layout fields the envelope may set. Absent = the file's value is
 *  kept verbatim (the gateway merges attribute-by-attribute). `null` clears
 *  the corresponding defined name (`printArea` / `printTitles`). */
export interface XlsxPageSetupFields {
  readonly orientation?: "portrait" | "landscape" | undefined;
  readonly paperSize?: number | undefined;
  readonly scale?: number | undefined;
  readonly fitToWidth?: number | undefined;
  readonly fitToHeight?: number | undefined;
  readonly fitToPage?: boolean | undefined;
  readonly margins?: "normal" | "wide" | "narrow" | undefined;
  readonly printGridlines?: boolean | undefined;
  readonly printHeadings?: boolean | undefined;
  /** A1 range to print, or null to clear the sheet's print area. */
  readonly printArea?: string | null | undefined;
  /** Rows repeated at the top of every page ("1:2"), or null to clear. */
  readonly printTitles?: string | null | undefined;
  readonly frozenRows?: number | undefined;
  readonly frozenColumns?: number | undefined;
  /** Manual page breaks (0-based index of the row/column after the break). */
  readonly rowBreaks?: readonly number[] | undefined;
  readonly colBreaks?: readonly number[] | undefined;
}

/** The envelope op (pageSetupStates slot): the sheet's CURRENT name plus the
 *  page-layout fields one edit carries (only the fields the UI changed; the
 *  model merges them field-wise with earlier ops for the same sheet). */
export type XlsxPageSetupOp = {
  readonly kind: "set_page_setup";
  readonly sheetName: string;
  readonly setup: XlsxPageSetupFields;
};

/** The gateway's SheetPageSetupState for one sheet: the sheet name the
 *  worksheet part is looked up by plus the fields (upstream
 *  xlsx-page-setup.ts). */
export interface XlsxSheetPageSetupState extends XlsxPageSetupFields {
  readonly sheetName: string;
}

export const PAGE_SETUP_OP_KIND = "set_page_setup";

export function isXlsxPageSetupOp(op: XlsxEditOp): op is XlsxPageSetupOp {
  return op.kind === PAGE_SETUP_OP_KIND;
}

/** The op's present fields (an absent field is `undefined` in the typed op and
 *  must not clobber an earlier op's value). `null` is a real value (it clears a
 *  defined name), so it is kept. */
function presentFields(setup: XlsxPageSetupFields): XlsxPageSetupFields {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(setup)) {
    if (value !== undefined) out[key] = value;
  }
  return out as XlsxPageSetupFields;
}

/** Fold page-setup ops per sheet, in emission order, first-touch sheet order.
 *
 *  Merge rule: the op carries a PARTIAL field set (only what the UI changed),
 *  and the gateway merges each present field into the worksheet while leaving
 *  absent fields verbatim. So the fold is field-wise last-write-wins: a later
 *  op overrides only the fields it carries, and an earlier op's other fields
 *  survive. (A whole-op replace would silently drop an earlier dialog apply's
 *  settings the moment a second one touched a different field.) `null` is a
 *  value, not an absence, so a later `printArea: null` clears the name.
 *
 *  Empty when the session has no page-setup edits. */
export function groupXlsxPageSetupStates(ops: readonly XlsxEditOp[]): XlsxSheetPageSetupState[] {
  const bySheet = new Map<string, XlsxSheetPageSetupState>();
  for (const op of ops) {
    if (!isXlsxPageSetupOp(op)) continue;
    const previous = bySheet.get(op.sheetName);
    bySheet.set(op.sheetName, { ...previous, ...presentFields(op.setup), sheetName: op.sheetName });
  }
  return [...bySheet.values()];
}