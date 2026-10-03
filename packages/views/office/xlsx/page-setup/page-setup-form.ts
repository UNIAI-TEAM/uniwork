// C2 (UNI-926): the Page Setup dialog's pure form model. The dialog edits a
// form of "keep the file's value" or an explicit setting per field; this module
// maps the form to the engine's XlsxPageSetupFields, refusing an empty result
// (a page-setup op needs at least one setting) and validating the free-text
// fields with the same grammar the engine parser uses.
import type { XlsxPageSetupFields } from "@uniwork/office-engine/xlsx";
import { addressParts } from "../xlsx-editor-model";
import type { XlsxSelection } from "../types";

/** OOXML paper-size codes the dialog offers (ST_PaperSize). */
export const XLSX_PAPER_SIZES: readonly { readonly value: number; readonly key: string }[] = [
  { value: 1, key: "letter" },
  { value: 3, key: "tabloid" },
  { value: 5, key: "legal" },
  { value: 8, key: "a3" },
  { value: 9, key: "a4" },
  { value: 11, key: "a5" },
];

export const XLSX_MARGIN_PRESETS = ["normal", "wide", "narrow"] as const;
export type XlsxMarginPreset = (typeof XLSX_MARGIN_PRESETS)[number];

/** One tri-state select: keep the file's value, or set an explicit one. */
export type XlsxTriState<T extends string> = "keep" | T;
export type XlsxBooleanState = "keep" | "on" | "off";

export interface XlsxPageSetupFormState {
  orientation: XlsxTriState<"portrait" | "landscape">;
  paperSize: "keep" | number;
  margins: XlsxTriState<XlsxMarginPreset>;
  /** Empty keeps the file's scale; a number is 10-400. */
  scale: string;
  fitToPage: XlsxBooleanState;
  /** Empty keeps the file's value; a number is 0-1000. */
  fitToWidth: string;
  fitToHeight: string;
  printGridlines: XlsxBooleanState;
  printHeadings: XlsxBooleanState;
  /** Empty keeps the file's value; a number is 0-1048575 / 0-16383. */
  frozenRows: string;
  frozenColumns: string;
  /** keep = leave the defined name; selection = set it from the selection;
   *  clear = remove it (null). */
  printArea: "keep" | "selection" | "clear";
  /** Empty keeps the file's titles; "1:2" sets them; the clear box removes. */
  printTitles: string;
  printTitlesClear: boolean;
}

export function initialPageSetupForm(): XlsxPageSetupFormState {
  return {
    orientation: "keep",
    paperSize: "keep",
    margins: "keep",
    scale: "",
    fitToPage: "keep",
    fitToWidth: "",
    fitToHeight: "",
    printGridlines: "keep",
    printHeadings: "keep",
    frozenRows: "",
    frozenColumns: "",
    printArea: "keep",
    printTitles: "",
    printTitlesClear: false,
  };
}

/** A bounded integer text field: empty is null (keep), a non-integer or an
 *  out-of-range value is "invalid". */
export function boundedInt(text: string, min: number, max: number): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const value = Number.parseInt(trimmed, 10);
  return value >= min && value <= max ? value : "invalid";
}

/** The print area a selection spans, in A1 form ("A1:C10"); null when the
 *  selection is absent or unreadable. */
export function selectionPrintArea(selection: XlsxSelection | null): string | null {
  if (!selection) return null;
  const first = addressParts(selection.address);
  const last = selection.endAddress ? addressParts(selection.endAddress) : first;
  if (!first || !last) return null;
  const startRow = Math.min(first.row, last.row);
  const endRow = Math.max(first.row, last.row);
  const startColumn = Math.min(first.column, last.column);
  const endColumn = Math.max(first.column, last.column);
  const address = (row: number, column: number): string => {
    let label = "";
    for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
    return `${label}${row + 1}`;
  };
  const start = address(startRow, startColumn);
  const end = address(endRow, endColumn);
  return start === end ? start : `${start}:${end}`;
}

/** "1:3" (1-based, ascending) or null. */
export function printTitlesSpan(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,7}):(\d{1,7})$/.exec(trimmed);
  if (!match || Number(match[1]) > Number(match[2])) return null;
  return trimmed;
}

export type XlsxPageSetupBuild =
  | { readonly ok: true; readonly fields: XlsxPageSetupFields }
  | { readonly ok: false; readonly error: "empty" | "scale" | "fit" | "frozen" | "printTitles" | "printArea" };

/** Map the form onto the engine's fields. Only non-"keep" entries ride the op;
 *  the gateway keeps every absent field verbatim. */
export function buildPageSetupFields(
  form: XlsxPageSetupFormState,
  selection: XlsxSelection | null,
): XlsxPageSetupBuild {
  const fields: {
    orientation?: XlsxPageSetupFields["orientation"];
    paperSize?: number;
    margins?: XlsxPageSetupFields["margins"];
    scale?: number;
    fitToPage?: boolean;
    fitToWidth?: number;
    fitToHeight?: number;
    printGridlines?: boolean;
    printHeadings?: boolean;
    frozenRows?: number;
    frozenColumns?: number;
    printArea?: string | null;
    printTitles?: string | null;
  } = {};

  if (form.orientation !== "keep") fields.orientation = form.orientation;
  if (form.paperSize !== "keep") fields.paperSize = form.paperSize;
  if (form.margins !== "keep") fields.margins = form.margins;

  const scale = boundedInt(form.scale, 10, 400);
  if (scale === "invalid") return { ok: false, error: "scale" };
  if (scale !== null) fields.scale = scale;

  if (form.fitToPage !== "keep") fields.fitToPage = form.fitToPage === "on";
  const fitToWidth = boundedInt(form.fitToWidth, 0, 1_000);
  if (fitToWidth === "invalid") return { ok: false, error: "fit" };
  if (fitToWidth !== null) fields.fitToWidth = fitToWidth;
  const fitToHeight = boundedInt(form.fitToHeight, 0, 1_000);
  if (fitToHeight === "invalid") return { ok: false, error: "fit" };
  if (fitToHeight !== null) fields.fitToHeight = fitToHeight;

  if (form.printGridlines !== "keep") fields.printGridlines = form.printGridlines === "on";
  if (form.printHeadings !== "keep") fields.printHeadings = form.printHeadings === "on";

  const frozenRows = boundedInt(form.frozenRows, 0, 1_048_575);
  if (frozenRows === "invalid") return { ok: false, error: "frozen" };
  if (frozenRows !== null) fields.frozenRows = frozenRows;
  const frozenColumns = boundedInt(form.frozenColumns, 0, 16_383);
  if (frozenColumns === "invalid") return { ok: false, error: "frozen" };
  if (frozenColumns !== null) fields.frozenColumns = frozenColumns;

  if (form.printArea === "clear") {
    fields.printArea = null;
  } else if (form.printArea === "selection") {
    const area = selectionPrintArea(selection);
    if (area === null) return { ok: false, error: "printArea" };
    fields.printArea = area;
  }

  if (form.printTitlesClear) {
    fields.printTitles = null;
  } else if (form.printTitles.trim() !== "") {
    const span = printTitlesSpan(form.printTitles);
    if (span === null) return { ok: false, error: "printTitles" };
    fields.printTitles = span;
  }

  if (Object.values(fields).every((value) => value === undefined)) return { ok: false, error: "empty" };
  return { ok: true, fields };
}
