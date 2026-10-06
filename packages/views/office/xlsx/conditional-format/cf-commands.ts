// Conditional Formatting "Highlight Cells Rules" presets: pure rule building.
// The save gateway maps exactly the inner shapes built here to OOXML, so keep
// them in lockstep with it. The hex values below are DATA written into the
// file (cell formats), not UI colours.

import { parsePlainDecimal } from "../data-validation/dv-commands";

export const XLSX_CF_ADD_COMMAND = "sheet.command.add-conditional-rule";
export const XLSX_CF_CLEAR_RANGE_COMMAND = "sheet.command.clear-range-conditional-rule";
export const XLSX_CF_CLEAR_SHEET_COMMAND = "sheet.command.clear-worksheet-conditional-rule";
export const XLSX_CF_SET_COMMAND = "sheet.command.set-conditional-rule";
export const XLSX_CF_MOVE_COMMAND = "sheet.command.move-conditional-rule";
export const XLSX_CF_DELETE_COMMAND = "sheet.command.delete-conditional-rule";

const TEXT_MAX_LENGTH = 255;

export type XlsxCfPreset = "greaterThan" | "lessThan" | "between" | "containsText" | "duplicateValues" | "uniqueValues";
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

/** The preset whose cell format equals `style`, or null for any other format. */
export function matchCfStyleId(style: unknown): XlsxCfStyleId | null {
  if (!style || typeof style !== "object") return null;
  const { bg, cl, ...rest } = style as { bg?: { rgb?: unknown }; cl?: { rgb?: unknown } };
  if (Object.keys(rest).length > 0) return null;
  const bgRgb = typeof bg?.rgb === "string" ? bg.rgb.toUpperCase() : undefined;
  const clRgb = typeof cl?.rgb === "string" ? cl.rgb.toUpperCase() : undefined;
  return (
    XLSX_CF_STYLE_IDS.find((id) => STYLES[id].bg?.rgb.toUpperCase() === bgRgb && STYLES[id].cl?.rgb.toUpperCase() === clRgb) ?? null
  );
}

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
  return parsePlainDecimal(raw);
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
    case "uniqueValues":
      return { ok: true, inner: { type: "highlightCell", subType: "uniqueValues", style } };
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

/** Params of `sheet.command.set-conditional-rule`: replaces the rule `cfId`
 *  keeping its areas and stop-if-true flag. */
export function setRuleParams(
  unitId: string,
  subUnitId: string,
  cfId: string,
  ranges: readonly XlsxCfRange[],
  stopIfTrue: boolean,
  inner: Record<string, unknown>,
) {
  return {
    unitId,
    subUnitId,
    cfId,
    rule: { cfId, ranges: ranges.map((range) => ({ ...range })), stopIfTrue, rule: inner },
  };
}

/** Params of `sheet.command.move-conditional-rule`: puts `cfId` before or
 *  after `otherCfId` in the priority list. */
export function moveRuleParams(unitId: string, subUnitId: string, cfId: string, otherCfId: string, place: "before" | "after") {
  return { unitId, subUnitId, start: { id: cfId, type: "self" }, end: { id: otherCfId, type: place } };
}

export function deleteRuleParams(unitId: string, subUnitId: string, cfId: string) {
  return { unitId, subUnitId, cfId };
}
