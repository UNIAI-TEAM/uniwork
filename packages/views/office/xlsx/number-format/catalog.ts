import type { XlsxSelection } from "../types";
import { addressParts } from "../xlsx-editor-model";

/** One gallery entry: `pattern` is the Excel/OOXML format code applied to the
 *  selection; `labelKey` is the localized sample the button shows. */
export interface XlsxNumberFormatPreset {
  readonly id: string;
  readonly labelKey: string;
  readonly pattern: string;
}

export interface XlsxNumberFormatCategory {
  readonly id: string;
  readonly labelKey: string;
  readonly presets: readonly XlsxNumberFormatPreset[];
}

/** The pinned Univer numfmt commands. `set` is a synchronous handler; the two
 *  decimal steppers are async handlers (see `command-runner.ts`). */
export const XLSX_NUMBER_FORMAT_COMMANDS = {
  set: "sheet.command.numfmt.set.numfmt",
  increaseDecimals: "sheet.command.numfmt.add.decimal.command",
  decreaseDecimals: "sheet.command.numfmt.subtract.decimal.command",
} as const;

/** Matches the facade guard in `setNumberFormat` and the OOXML code limit. */
export const XLSX_CUSTOM_FORMAT_MAX_LENGTH = 255;
/** The command policy's own range bound (`canEditRange`): a bigger selection
 *  is refused by the renderer, so the UI never expands one. */
export const XLSX_NUMBER_FORMAT_MAX_CELLS = 100_000;

function preset(id: string, pattern: string): XlsxNumberFormatPreset {
  return { id, pattern, labelKey: `office.xlsx.toolbar.groups.numberFormat.presets.${id}` };
}

function category(id: string, presets: readonly XlsxNumberFormatPreset[]): XlsxNumberFormatCategory {
  return { id, presets, labelKey: `office.xlsx.toolbar.groups.numberFormat.categories.${id}` };
}

/** Curated presets, not a replica of Univer's full panel: the standard number
 *  variants plus the formats vi-VN and en workbooks actually use. */
export const XLSX_NUMBER_FORMAT_CATEGORIES: readonly XlsxNumberFormatCategory[] = [
  category("general", [preset("general", "General")]),
  category("number", [
    preset("number-integer", "0"),
    preset("number-decimal1", "0.0"),
    preset("number-decimal2", "0.00"),
    preset("number-thousands", "#,##0"),
    preset("number-thousands-decimal2", "#,##0.00"),
  ]),
  category("currency", [
    preset("currency-vnd", '#,##0" ₫"'),
    preset("currency-usd", '"$"#,##0.00'),
    preset("currency-eur", '"€"#,##0.00'),
  ]),
  category("accounting", [
    preset("accounting-integer", "#,##0_);(#,##0)"),
    preset("accounting-decimal2", "#,##0.00_);(#,##0.00)"),
  ]),
  category("date", [
    preset("date-iso", "yyyy-mm-dd"),
    preset("date-dmy", "dd/mm/yyyy"),
    preset("date-mdy", "mm/dd/yyyy"),
  ]),
  category("time", [
    preset("time-hm", "hh:mm"),
    preset("time-hms", "hh:mm:ss"),
    preset("time-hm-ampm", "h:mm AM/PM"),
  ]),
  category("percent", [preset("percent-integer", "0%"), preset("percent-decimal2", "0.00%")]),
  category("text", [preset("text", "@")]),
];

/** The pattern of a catalog preset; throws on an unknown id so a typo in a
 *  ribbon button fails loudly in its test instead of applying nothing. */
export function presetPattern(id: string): string {
  for (const entry of XLSX_NUMBER_FORMAT_CATEGORIES) {
    const found = entry.presets.find((candidate) => candidate.id === id);
    if (found) return found.pattern;
  }
  throw new Error(`unknown number format preset ${id}`);
}

/** i18n key of the category a pattern belongs to (the "name" the ribbon shows,
 *  like Excel's "Currency"); a pattern outside the catalog is "Custom". */
export function patternNameKey(pattern: string | null): string {
  if (pattern === null) return "office.xlsx.toolbar.groups.numberFormat.categories.general";
  const owner = XLSX_NUMBER_FORMAT_CATEGORIES.find((entry) => entry.presets.some((candidate) => candidate.pattern === pattern));
  return owner ? owner.labelKey : "office.xlsx.toolbar.groups.numberFormat.custom";
}

export type XlsxCustomFormatError = "empty" | "tooLong" | "controlChar";

export type XlsxCustomFormatResult = { readonly pattern: string } | { readonly error: XlsxCustomFormatError };

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Custom entry validation: trimmed, non-empty, within the code limit and free
 *  of line breaks/control characters. Anything else is refused with a key the
 *  caller renders as an error. */
export function validateCustomFormat(input: string): XlsxCustomFormatResult {
  const pattern = input.trim();
  if (!pattern) return { error: "empty" };
  if (pattern.length > XLSX_CUSTOM_FORMAT_MAX_LENGTH) return { error: "tooLong" };
  if (hasControlCharacter(pattern)) return { error: "controlChar" };
  return { pattern };
}

export interface XlsxNumberFormatCell {
  readonly row: number;
  readonly column: number;
}

/** Expands a workspace selection (A1 start, optional A1 end) into the 0-based
 *  cell list the pinned `set.numfmt` command expects. Returns null when the
 *  address cannot be parsed or the selection exceeds the policy bound. */
export function selectionFormatCells(selection: XlsxSelection | null): readonly XlsxNumberFormatCell[] | null {
  if (!selection) return null;
  const start = addressParts(selection.address);
  const end = selection.endAddress ? addressParts(selection.endAddress) : start;
  if (!start || !end) return null;
  const startRow = Math.min(start.row, end.row);
  const endRow = Math.max(start.row, end.row);
  const startColumn = Math.min(start.column, end.column);
  const endColumn = Math.max(start.column, end.column);
  if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > XLSX_NUMBER_FORMAT_MAX_CELLS) return null;
  const cells: XlsxNumberFormatCell[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let column = startColumn; column <= endColumn; column++) cells.push({ row, column });
  }
  return cells;
}

/** The exact params the pinned `sheet.command.numfmt.set.numfmt` handler reads:
 *  one `{ row, col, pattern }` entry per selected cell. */
export function numberFormatCommandParams(cells: readonly XlsxNumberFormatCell[], pattern: string) {
  return { values: cells.map(({ row, column }) => ({ row, col: column, pattern })) };
}
