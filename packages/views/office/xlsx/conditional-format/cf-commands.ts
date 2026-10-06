// Conditional Formatting "Highlight Cells Rules" presets: pure rule building.
// The save gateway maps exactly the inner shapes built here to OOXML, so keep
// them in lockstep with it. The hex values below are DATA written into the
// file (cell formats), not UI colours.

export const XLSX_CF_ADD_COMMAND = "sheet.command.add-conditional-rule";
export const XLSX_CF_CLEAR_RANGE_COMMAND = "sheet.command.clear-range-conditional-rule";
export const XLSX_CF_CLEAR_SHEET_COMMAND = "sheet.command.clear-worksheet-conditional-rule";

const TEXT_MAX_LENGTH = 255;

export type XlsxCfPreset = "greaterThan" | "lessThan" | "between" | "containsText" | "duplicateValues";
export type XlsxCfStyleId = "lightRedDarkRed" | "yellowDarkYellow" | "greenDarkGreen" | "lightRedFill" | "redText";

export interface XlsxCfRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

interface XlsxCfStyle {
  bg?: { rgb: string };
  cl?: { rgb: string };
}

export const XLSX_CF_STYLE_IDS: readonly XlsxCfStyleId[] = [
  "lightRedDarkRed",
  "yellowDarkYellow",
  "greenDarkGreen",
  "lightRedFill",
  "redText",
];

const STYLES: Record<XlsxCfStyleId, XlsxCfStyle> = {
  lightRedDarkRed: { bg: { rgb: "#FFC7CE" }, cl: { rgb: "#9C0006" } },
  yellowDarkYellow: { bg: { rgb: "#FFEB9C" }, cl: { rgb: "#9C5700" } },
  greenDarkGreen: { bg: { rgb: "#C6EFCE" }, cl: { rgb: "#006100" } },
  lightRedFill: { bg: { rgb: "#FFC7CE" } },
  redText: { cl: { rgb: "#9C0006" } },
};

export function cfStyleOf(id: XlsxCfStyleId): XlsxCfStyle {
  const style = STYLES[id];
  return { ...(style.bg ? { bg: { ...style.bg } } : {}), ...(style.cl ? { cl: { ...style.cl } } : {}) };
}

type XlsxCfValueError = "invalidNumber" | "invalidRange" | "emptyText" | "textTooLong";

interface XlsxCfInput {
  /** First number / the text; `second` is the Between upper bound. */
  first: string;
  second: string;
}

type XlsxCfBuild =
  | { ok: true; inner: Record<string, unknown> }
  | { ok: false; error: XlsxCfValueError };

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Builds the inner Univer highlight rule for a preset, or reports why the
 *  typed values are not acceptable. */
export function buildCfInnerRule(preset: XlsxCfPreset, input: XlsxCfInput, styleId: XlsxCfStyleId): XlsxCfBuild {
  const style = cfStyleOf(styleId);
  switch (preset) {
    case "greaterThan":
    case "lessThan": {
      const value = parseNumber(input.first);
      if (value === null) return { ok: false, error: "invalidNumber" };
      return { ok: true, inner: { type: "highlightCell", subType: "number", operator: preset, value, style } };
    }
    case "between": {
      const min = parseNumber(input.first);
      const max = parseNumber(input.second);
      if (min === null || max === null) return { ok: false, error: "invalidNumber" };
      if (min > max) return { ok: false, error: "invalidRange" };
      return { ok: true, inner: { type: "highlightCell", subType: "number", operator: "between", value: [min, max], style } };
    }
    case "containsText": {
      if (input.first.length === 0) return { ok: false, error: "emptyText" };
      if (input.first.length > TEXT_MAX_LENGTH) return { ok: false, error: "textTooLong" };
      return { ok: true, inner: { type: "highlightCell", subType: "text", operator: "containsText", value: input.first, style } };
    }
    case "duplicateValues":
      return { ok: true, inner: { type: "highlightCell", subType: "duplicateValues", style } };
    default:
      return { ok: false, error: "invalidNumber" };
  }
}

let cfCounter = 0;

function newCfId(): string {
  cfCounter += 1;
  return `uw-cf-${Date.now().toString(36)}${cfCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Params of `sheet.command.add-conditional-rule`. */
export function addRuleParams(unitId: string, subUnitId: string, range: XlsxCfRange, inner: Record<string, unknown>) {
  return {
    unitId,
    subUnitId,
    rule: { cfId: newCfId(), ranges: [{ ...range }], stopIfTrue: false, rule: inner },
  };
}

export function clearRangeParams(unitId: string, subUnitId: string, range: XlsxCfRange) {
  return { unitId, subUnitId, ranges: [{ ...range }] };
}

export function clearSheetParams(unitId: string, subUnitId: string) {
  return { unitId, subUnitId };
}
