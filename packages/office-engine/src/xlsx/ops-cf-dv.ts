// XLSX conditional-formatting + data-validation op parsers (X01, cfStates /
// dvStates slots). The shared vocabulary lives in ops-shared.ts.
//
// Wire shapes:
//   { op: "set_conditional_formats", target: { sheet }, attributes: { rules: [
//       { ranges: [area], stopIfTrue, rule } ] } }
//   { op: "set_data_validations", target: { sheet }, attributes: { rules: [
//       { ranges: [area], rule } ] } }
// Both are whole-sheet DECLARATIVE snapshots of the renderer's Univer rule
// model: the gateway's applyCfRules / applyDvRules rewrite the worksheet's
// complete <conditionalFormatting> / <dataValidations> sections from them (an
// empty list removes every rule), so the model folds the last op per sheet.
// `rule` is Univer's rule JSON - the gateway owns that vocabulary and maps it
// strictly to OOXML, failing closed on shapes it cannot represent. This
// parser only bounds the envelope and refuses the rule types the gateway is
// known to refuse, so an unsaveable edit fails at edit time, not at save.
// Coordinates are 0-based and final at emission (the pinned CF/DV plugins
// re-emit their rule mutations after a structural shift, and the renderer
// re-snapshots), and the gateway applies both after the worksheet flush.
import {
  XlsxOpError,
  isDict,
  int,
  parseStructuralTarget,
  parseStructuralAttributes,
  MAX_ROWS,
  MAX_COLS,
  type Dict,
  type XlsxEditOp,
  type XlsxSheetResolver,
} from "./ops-shared.ts";

export const CONDITIONAL_FORMATS_OP_KIND = "set_conditional_formats";
export const DATA_VALIDATIONS_OP_KIND = "set_data_validations";

/** Rules per sheet and areas per rule; Excel sheets in the wild stay far
 *  below either. */
const MAX_RULES = 1_000;
const MAX_RULE_AREAS = 1_000;
/** The serialized Univer rule JSON (formulas, styles, icon configs). */
const MAX_RULE_JSON = 65_536;
/** The rule families the gateway serializer writes (xlsx-cf.ts / xlsx-dv.ts). */
const CF_RULE_TYPES = new Set(["highlightCell", "colorScale", "dataBar", "iconSet"]);
const DV_RULE_TYPES = new Set(["any", "none", "whole", "decimal", "list", "date", "time", "textLength", "custom", "checkbox"]);

/** A rule area: 0-based, ordered and inside the OOXML grid. Whole columns and
 *  rows are legitimate CF/DV targets, so there is no span ceiling. */
export interface XlsxRuleArea {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

/** One conditional-formatting rule (the gateway's CfWireRule). */
export interface XlsxConditionalFormatRule {
  readonly ranges: readonly XlsxRuleArea[];
  readonly stopIfTrue: boolean;
  readonly rule: Readonly<Record<string, unknown>>;
}

/** One data-validation rule (the gateway's DvWireRule). */
export interface XlsxDataValidationRule {
  readonly ranges: readonly XlsxRuleArea[];
  readonly rule: Readonly<Record<string, unknown>>;
}

export type XlsxConditionalFormatsOp = {
  readonly kind: "set_conditional_formats";
  readonly sheetName: string;
  readonly rules: readonly XlsxConditionalFormatRule[];
};

export type XlsxDataValidationsOp = {
  readonly kind: "set_data_validations";
  readonly sheetName: string;
  readonly rules: readonly XlsxDataValidationRule[];
};

/** The gateway's SheetCfState: the sheet name plus its complete rule set. */
export interface XlsxSheetConditionalFormatState {
  readonly sheetName: string;
  readonly rules: readonly XlsxConditionalFormatRule[];
}

/** The gateway's SheetDvState: the sheet name plus its complete rule set. */
export interface XlsxSheetDataValidationState {
  readonly sheetName: string;
  readonly rules: readonly XlsxDataValidationRule[];
}

/** The per-sheet rule-set journal entry the session model keeps: the last
 *  snapshot of each family. */
export interface XlsxRuleSetEntry {
  readonly conditionalFormats?: XlsxConditionalFormatsOp | undefined;
  readonly dataValidations?: XlsxDataValidationsOp | undefined;
}

export type XlsxRuleSetOp = XlsxConditionalFormatsOp | XlsxDataValidationsOp;

export function isXlsxRuleSetOp(op: XlsxEditOp): op is XlsxRuleSetOp {
  return op.kind === CONDITIONAL_FORMATS_OP_KIND || op.kind === DATA_VALIDATIONS_OP_KIND;
}

function parseRuleArea(raw: unknown, op: string): XlsxRuleArea {
  const field = "attributes.rules.ranges";
  if (!isDict(raw)) throw new XlsxOpError(op, field, "area objects required");
  const startRow = int(raw.startRow, op, `${field}.startRow`);
  const endRow = int(raw.endRow, op, `${field}.endRow`);
  const startColumn = int(raw.startColumn, op, `${field}.startColumn`);
  const endColumn = int(raw.endColumn, op, `${field}.endColumn`);
  if (startRow < 0 || startColumn < 0 || startRow > endRow || startColumn > endColumn ||
      endRow >= MAX_ROWS || endColumn >= MAX_COLS) {
    throw new XlsxOpError(op, field, "area must be ordered and inside the OOXML grid");
  }
  return { startRow, endRow, startColumn, endColumn };
}

function parseRuleAreas(raw: unknown, op: string): XlsxRuleArea[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_RULE_AREAS) {
    throw new XlsxOpError(op, "attributes.rules.ranges", `1 to ${MAX_RULE_AREAS} areas required`);
  }
  return raw.map((area) => parseRuleArea(area, op));
}

/** The Univer rule JSON: a plain object with a known `type`, bounded in size,
 *  returned as a JSON-only deep copy (nothing but data reaches the gateway). */
function parseRuleJson(raw: unknown, op: string, types: ReadonlySet<string>): Record<string, unknown> {
  if (!isDict(raw)) throw new XlsxOpError(op, "attributes.rules.rule", "object required");
  if (typeof raw.type !== "string" || !types.has(raw.type)) {
    throw new XlsxOpError(op, "attributes.rules.rule.type", "rule type cannot be saved to xlsx");
  }
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    throw new XlsxOpError(op, "attributes.rules.rule", "JSON data required");
  }
  if (text.length > MAX_RULE_JSON) throw new XlsxOpError(op, "attributes.rules.rule", "rule exceeds the size bound");
  return JSON.parse(text) as Record<string, unknown>;
}

function parseRules(item: Dict, op: string): unknown[] {
  const a = parseStructuralAttributes(item, op);
  if (!Array.isArray(a.rules) || a.rules.length > MAX_RULES) {
    throw new XlsxOpError(op, "attributes.rules", `at most ${MAX_RULES} rules required`);
  }
  return a.rules;
}

export function parseSetConditionalFormats(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const rules = parseRules(item, op).map((raw): XlsxConditionalFormatRule => {
    if (!isDict(raw)) throw new XlsxOpError(op, "attributes.rules", "rule objects required");
    if (raw.stopIfTrue !== undefined && typeof raw.stopIfTrue !== "boolean") {
      throw new XlsxOpError(op, "attributes.rules.stopIfTrue", "boolean required");
    }
    return {
      ranges: parseRuleAreas(raw.ranges, op),
      stopIfTrue: raw.stopIfTrue === true,
      rule: parseRuleJson(raw.rule, op, CF_RULE_TYPES),
    };
  });
  return [{ kind: CONDITIONAL_FORMATS_OP_KIND, sheetName, rules }];
}

export function parseSetDataValidations(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const rules = parseRules(item, op).map((raw): XlsxDataValidationRule => {
    if (!isDict(raw)) throw new XlsxOpError(op, "attributes.rules", "rule objects required");
    return { ranges: parseRuleAreas(raw.ranges, op), rule: parseRuleJson(raw.rule, op, DV_RULE_TYPES) };
  });
  return [{ kind: DATA_VALIDATIONS_OP_KIND, sheetName, rules }];
}

/** Fold one rule-set op into its sheet's journal entry (last write per family
 *  wins). */
export function withRuleSetOp(entry: XlsxRuleSetEntry | undefined, op: XlsxRuleSetOp): XlsxRuleSetEntry {
  return op.kind === CONDITIONAL_FORMATS_OP_KIND
    ? { ...entry, conditionalFormats: op }
    : { ...entry, dataValidations: op };
}

/** The same entry re-addressed to another sheet name (rename / duplicate). */
export function renamedRuleSet(entry: XlsxRuleSetEntry, sheetName: string): XlsxRuleSetEntry {
  return {
    ...(entry.conditionalFormats ? { conditionalFormats: { ...entry.conditionalFormats, sheetName } } : {}),
    ...(entry.dataValidations ? { dataValidations: { ...entry.dataValidations, sheetName } } : {}),
  };
}

/** The gateway's cfStates argument: one whole-sheet state per touched sheet,
 *  in first-touch order. */
export function pendingConditionalFormatStates(entries: Iterable<XlsxRuleSetEntry>): XlsxSheetConditionalFormatState[] {
  const states: XlsxSheetConditionalFormatState[] = [];
  for (const entry of entries) {
    const op = entry.conditionalFormats;
    if (op) states.push({ sheetName: op.sheetName, rules: op.rules });
  }
  return states;
}

/** The gateway's dvStates argument, same shape and order as the CF one. */
export function pendingDataValidationStates(entries: Iterable<XlsxRuleSetEntry>): XlsxSheetDataValidationState[] {
  const states: XlsxSheetDataValidationState[] = [];
  for (const entry of entries) {
    const op = entry.dataValidations;
    if (op) states.push({ sheetName: op.sheetName, rules: op.rules });
  }
  return states;
}
