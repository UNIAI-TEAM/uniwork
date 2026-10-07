// Data Validation rules editor core. Pure, renderer-free: maps the dialog's
// form onto the pinned @univerjs/sheets-data-validation 0.25.1 commands, so the
// dialog, the group and the tests share one rule-building path. The commands
// run through the toolbar's one command port; the save/journal path is not
// owned here.

import { addressParts } from "../xlsx-editor-model";
import type { XlsxSelection } from "../types";

export const XLSX_DV_ADD_COMMAND = "sheet.command.addDataValidation";
export const XLSX_DV_CLEAR_COMMAND = "sheets.command.clear-range-data-validation";
export const XLSX_DV_SETTING_COMMAND = "sheets.command.update-data-validation-setting";
export const XLSX_DV_OPTIONS_COMMAND = "sheets.command.update-data-validation-options";
export const XLSX_DV_REMOVE_COMMAND = "sheet.command.remove-data-validation-rule";

export const XLSX_DV_ERROR_STYLES = ["stop", "warning", "information"] as const;
export type XlsxDvErrorStyle = (typeof XLSX_DV_ERROR_STYLES)[number];
/** Univer's DataValidationErrorStyle: INFO = 0, STOP = 1, WARNING = 2. */
const ERROR_STYLE_CODE = { stop: 1, warning: 2, information: 0 } as const;

/** The error style a stored code names; an absent code is Excel's default, stop. */
export function errorStyleOfCode(code: unknown): XlsxDvErrorStyle {
  return XLSX_DV_ERROR_STYLES.find((style) => ERROR_STYLE_CODE[style] === code) ?? "stop";
}

export const XLSX_DV_TYPES = ["list", "whole", "decimal", "date"] as const;
export type XlsxDvType = (typeof XLSX_DV_TYPES)[number];

export const XLSX_DV_OPERATORS = [
  "between",
  "notBetween",
  "equal",
  "notEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
] as const;
export type XlsxDvOperator = (typeof XLSX_DV_OPERATORS)[number];

/** Excel's limits. */
const LIST_MAX_CHARS = 255;
export const XLSX_DV_ERROR_MAX_CHARS = 255;
export const XLSX_DV_TITLE_MAX_CHARS = 32;

const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;

export interface XlsxDvRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

interface XlsxDvRule {
  uid: string;
  type: XlsxDvType;
  operator?: XlsxDvOperator;
  formula1: string;
  formula2?: string;
  ranges: XlsxDvRange[];
  allowBlank: true;
  showErrorMessage: true;
  errorStyle: 0 | 1 | 2;
  error?: string;
  errorTitle?: string;
  showDropDown?: true;
}

export interface XlsxDvForm {
  type: XlsxDvType;
  operator: XlsxDvOperator;
  /** List source, or the first value / minimum. */
  value1: string;
  /** The second value (maximum) of between / notBetween. */
  value2: string;
  errorTitle: string;
  error: string;
  errorStyle: XlsxDvErrorStyle;
}

/** Which form field a validation failure belongs to, plus the i18n code under
 *  `office.xlsx.dataValidation.errors.*`. */
type XlsxDvField = "value1" | "value2" | "errorTitle" | "error";
export interface XlsxDvFailure {
  field: XlsxDvField;
  code:
    | "listEmpty"
    | "listEmptyItem"
    | "listBadChar"
    | "listTooLong"
    | "numberRequired"
    | "wholeRequired"
    | "dateRequired"
    | "rangeOrder"
    | "titleTooLong"
    | "messageTooLong";
}
type XlsxDvBuild = { ok: true; rule: XlsxDvRule } | { ok: false; failure: XlsxDvFailure };

export const XLSX_DV_EMPTY_FORM: XlsxDvForm = {
  type: "list",
  operator: "between",
  value1: "",
  value2: "",
  errorTitle: "",
  error: "",
  errorStyle: "stop",
};

export function isTwoValueOperator(operator: XlsxDvOperator): boolean {
  return operator === "between" || operator === "notBetween";
}

/** The in-grid, ordered rectangle a selection spans, or null. */
export function selectionDvRange(selection: XlsxSelection | null): XlsxDvRange | null {
  if (!selection) return null;
  const from = addressParts(selection.address);
  const to = selection.endAddress ? addressParts(selection.endAddress) : from;
  if (!from || !to) return null;
  const range = {
    startRow: Math.min(from.row, to.row),
    endRow: Math.max(from.row, to.row),
    startColumn: Math.min(from.column, to.column),
    endColumn: Math.max(from.column, to.column),
  };
  return range.endRow < MAX_ROW && range.endColumn < MAX_COLUMN ? range : null;
}

/** "YYYY-MM-DD" that names a real calendar day. */
export function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function newUid(): string {
  return `uw-dv-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const fail = (field: XlsxDvField, code: XlsxDvFailure["code"]): XlsxDvBuild => ({
  ok: false,
  failure: { field, code },
});

function listFormula(source: string): { formula: string } | XlsxDvFailure {
  const raw = source.trim();
  if (raw === "") return { field: "value1", code: "listEmpty" };
  const items = raw.split(",").map((item) => item.trim());
  if (items.some((item) => item === "")) return { field: "value1", code: "listEmptyItem" };
  if (items.some((item) => item.includes('"'))) return { field: "value1", code: "listBadChar" };
  const formula = items.join(",");
  if (formula.length > LIST_MAX_CHARS) return { field: "value1", code: "listTooLong" };
  return { formula };
}

/** A plain decimal ("10", "-1.5", ".5"): no hex, exponent, Infinity or blank.
 *  Shared with the conditional-format presets. */
export function parsePlainDecimal(raw: string): number | null {
  const text = raw.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

/** Checks one numeric/date value; returns the comparable number or a failure. */
function parseValue(
  type: "whole" | "decimal" | "date",
  field: "value1" | "value2",
  raw: string,
): { text: string; num: number } | XlsxDvFailure {
  const text = raw.trim();
  if (type === "date") {
    if (!isRealIsoDate(text)) return { field, code: "dateRequired" };
    return { text, num: Date.parse(`${text}T00:00:00Z`) };
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { field, code: "numberRequired" };
  const num = Number(text);
  if (!Number.isFinite(num)) return { field, code: "numberRequired" };
  if (type === "whole" && !Number.isInteger(num)) return { field, code: "wholeRequired" };
  return { text: String(num), num };
}

/** Univer's stored values, normalised for comparison: an absent error style
 *  is stop, an absent operator of a value rule is between, absent text is "". */
const storedStyle = (value: unknown): unknown => (value === undefined || value === null ? ERROR_STYLE_CODE.stop : value);
const storedText = (value: unknown): unknown => (value === undefined || value === null ? "" : value);
const storedOperator = (type: unknown, value: unknown): unknown =>
  type !== "list" && (value === undefined || value === "") ? "between" : storedText(value);

/** The commands that edit live rule `ruleId` in place: only the setting and
 *  the options that differ from `live` (one Ctrl+Z per edit, no empty undo
 *  steps), run as one all-or-nothing step by the dialog. The dialog edits
 *  neither the areas nor the "ignore blank" / "show alert" flags, so the live
 *  values of those flags are carried over, never reset (review dvcf F3, F4). */
export function updateDvCommands(
  unitId: string,
  subUnitId: string,
  ruleId: string,
  rule: XlsxDvRule,
  live: Readonly<Record<string, unknown>>,
): { id: string; params: unknown }[] {
  const steps: { id: string; params: unknown }[] = [];
  const settingChanged = rule.type !== live.type ||
    storedOperator(rule.type, rule.operator) !== storedOperator(live.type, live.operator) ||
    rule.formula1 !== storedText(live.formula1) || storedText(rule.formula2) !== storedText(live.formula2);
  if (settingChanged) {
    steps.push({
      id: XLSX_DV_SETTING_COMMAND,
      params: {
        unitId,
        subUnitId,
        ruleId,
        setting: { type: rule.type, operator: rule.operator, formula1: rule.formula1, formula2: rule.formula2, allowBlank: live.allowBlank },
      },
    });
  }
  const options = { errorStyle: rule.errorStyle, error: rule.error ?? "", errorTitle: rule.errorTitle ?? "" };
  const optionsChanged = options.errorStyle !== storedStyle(live.errorStyle) ||
    options.error !== storedText(live.error) || options.errorTitle !== storedText(live.errorTitle);
  if (optionsChanged) {
    steps.push({
      id: XLSX_DV_OPTIONS_COMMAND,
      params: { unitId, subUnitId, ruleId, options: { ...options, showErrorMessage: live.showErrorMessage } },
    });
  }
  return steps;
}

export function removeDvParams(unitId: string, subUnitId: string, ruleId: string) {
  return { unitId, subUnitId, ruleId };
}

/** Builds the pinned `IDataValidationRule` for the form over `range`. */
export function buildDvRule(form: XlsxDvForm, range: XlsxDvRange, uid: string = newUid()): XlsxDvBuild {
  const title = form.errorTitle.trim();
  const message = form.error.trim();
  if (title.length > XLSX_DV_TITLE_MAX_CHARS) return fail("errorTitle", "titleTooLong");
  if (message.length > XLSX_DV_ERROR_MAX_CHARS) return fail("error", "messageTooLong");
  const base = {
    uid,
    ranges: [{ ...range }],
    allowBlank: true as const,
    showErrorMessage: true as const,
    errorStyle: ERROR_STYLE_CODE[form.errorStyle],
    ...(message ? { error: message } : {}),
    ...(title ? { errorTitle: title } : {}),
  };
  if (form.type === "list") {
    const list = listFormula(form.value1);
    if ("code" in list) return { ok: false, failure: list };
    return { ok: true, rule: { ...base, type: "list", formula1: list.formula, showDropDown: true } };
  }
  const first = parseValue(form.type, "value1", form.value1);
  if ("code" in first) return { ok: false, failure: first };
  if (!isTwoValueOperator(form.operator)) {
    return { ok: true, rule: { ...base, type: form.type, operator: form.operator, formula1: first.text } };
  }
  const second = parseValue(form.type, "value2", form.value2);
  if ("code" in second) return { ok: false, failure: second };
  if (first.num > second.num) return fail("value2", "rangeOrder");
  return {
    ok: true,
    rule: { ...base, type: form.type, operator: form.operator, formula1: first.text, formula2: second.text },
  };
}

export function addDvParams(unitId: string, subUnitId: string, rule: XlsxDvRule) {
  return { unitId, subUnitId, rule };
}

export function clearDvParams(unitId: string, subUnitId: string, range: XlsxDvRange) {
  return { unitId, subUnitId, ranges: [{ ...range }] };
}
