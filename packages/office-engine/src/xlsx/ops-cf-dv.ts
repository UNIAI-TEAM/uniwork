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
  /** Positions of the wire ops folded into this state (r3 MA-2). */
  readonly sources?: readonly number[];
};

export type XlsxDataValidationsOp = {
  readonly kind: "set_data_validations";
  readonly sheetName: string;
  readonly rules: readonly XlsxDataValidationRule[];
  readonly sources?: readonly number[];
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

// ── inner rule shapes (review m2) ──────────────────────────────────────────
// Mirrors of the gateway serializers' fail-closed branches (xlsx-cf.ts
// serializeCfRule / highlightRule, xlsx-dv.ts serializeRule), so a snapshot
// the save would throw on is refused here, at edit time, instead of sitting
// in the journal and failing every later save. Colours and cfvo details stay
// the gateway's call: the toolbar writes fixed hex styles and loaded rules
// come from the file's own XML.
const CELL_IS_OPERATORS = new Set([
  "between", "notBetween", "equal", "notEqual", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual",
]);
const CF_TEXT_OPERATORS = new Set([
  "containsText", "notContainsText", "beginsWith", "endsWith", "equal", "notEqual",
  "containsBlanks", "notContainsBlanks", "containsErrors", "notContainsErrors",
]);
const CF_AVERAGE_OPERATORS = new Set(["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"]);
/** Univer DataValidationErrorStyle values the gateway maps (INFO, STOP, WARNING). */
const DV_ERROR_STYLES = new Set([0, 1, 2]);

const finiteNumber = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

function highlightUnsaveable(rule: Record<string, unknown>): string | null {
  const operator = rule.operator;
  switch (rule.subType) {
    case "number": {
      if (typeof operator !== "string" || !CELL_IS_OPERATORS.has(operator)) return "number operator cannot be saved";
      const values = Array.isArray(rule.value) ? rule.value : [rule.value];
      return values.every(finiteNumber) ? null : "number rule needs finite values";
    }
    case "text":
      return typeof operator === "string" && CF_TEXT_OPERATORS.has(operator) ? null : "text operator cannot be saved";
    case "duplicateValues":
    case "uniqueValues":
      return null;
    case "rank":
      return finiteNumber(rule.value) ? null : "top/bottom rule needs a rank";
    case "average":
      return typeof operator === "string" && CF_AVERAGE_OPERATORS.has(operator) ? null : "average operator cannot be saved";
    case "formula":
      return typeof rule.value === "string" && rule.value.length > 0 ? null : "formula rule needs a formula";
    default:
      return "highlight rule cannot be saved";
  }
}

function cfRuleUnsaveable(rule: Record<string, unknown>): string | null {
  switch (rule.type) {
    case "highlightCell":
      return highlightUnsaveable(rule);
    case "colorScale":
      return Array.isArray(rule.config) && rule.config.length >= 2 ? null : "color scale needs two stops";
    case "dataBar":
      return isDict(rule.config) ? null : "data bar needs a configuration";
    case "iconSet":
      return Array.isArray(rule.config) && rule.config.length >= 2 ? null : "icon set needs two thresholds";
  }
  return "rule type cannot be saved to xlsx";
}

function dvRuleUnsaveable(rule: Record<string, unknown>): string | null {
  const { operator, errorStyle } = rule;
  if (operator !== undefined && operator !== "" && (typeof operator !== "string" || !CELL_IS_OPERATORS.has(operator))) {
    return "validation operator cannot be saved";
  }
  if (errorStyle !== undefined && errorStyle !== null && !DV_ERROR_STYLES.has(Number(errorStyle))) {
    return "validation error style cannot be saved";
  }
  return null;
}

function requireSaveable(op: string, reason: string | null): void {
  if (reason !== null) throw new XlsxOpError(op, "attributes.rules.rule", reason);
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
    const rule = parseRuleJson(raw.rule, op, CF_RULE_TYPES);
    requireSaveable(op, cfRuleUnsaveable(rule));
    return { ranges: parseRuleAreas(raw.ranges, op), stopIfTrue: raw.stopIfTrue === true, rule };
  });
  return [{ kind: CONDITIONAL_FORMATS_OP_KIND, sheetName, rules }];
}

export function parseSetDataValidations(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const rules = parseRules(item, op).map((raw): XlsxDataValidationRule => {
    if (!isDict(raw)) throw new XlsxOpError(op, "attributes.rules", "rule objects required");
    const rule = parseRuleJson(raw.rule, op, DV_RULE_TYPES);
    requireSaveable(op, dvRuleUnsaveable(rule));
    return { ranges: parseRuleAreas(raw.ranges, op), rule };
  });
  return [{ kind: DATA_VALIDATIONS_OP_KIND, sheetName, rules }];
}

/** The parsed op stamped with its wire position (a rule-set op, or a
 *  duplicate_sheet whose copy inherits rule sets); other ops pass through. */
export function withRuleSetSource(op: XlsxEditOp, position: number): XlsxEditOp {
  return isXlsxRuleSetOp(op) || op.kind === "duplicate_sheet" ? { ...op, sources: [position] } : op;
}

/** Fold one rule-set op into its sheet's journal entry (last write per family
 *  wins). The state keeps the positions of every op folded into it, so a
 *  refused state names all of them (r3 MA-2). */
export function withRuleSetOp(entry: XlsxRuleSetEntry | undefined, op: XlsxRuleSetOp): XlsxRuleSetEntry {
  if (op.kind === CONDITIONAL_FORMATS_OP_KIND) {
    return { ...entry, conditionalFormats: { ...op, sources: [...(entry?.conditionalFormats?.sources ?? []), ...(op.sources ?? [])] } };
  }
  return { ...entry, dataValidations: { ...op, sources: [...(entry?.dataValidations?.sources ?? []), ...(op.sources ?? [])] } };
}

/** The entry without one family's snapshot; undefined once nothing is left. */
export function withoutRuleSetFamily(
  entry: XlsxRuleSetEntry | undefined,
  family: "conditionalFormats" | "dataValidations",
): XlsxRuleSetEntry | undefined {
  const rest: XlsxRuleSetEntry = family === "conditionalFormats"
    ? { ...(entry?.dataValidations ? { dataValidations: entry.dataValidations } : {}) }
    : { ...(entry?.conditionalFormats ? { conditionalFormats: entry.conditionalFormats } : {}) };
  return rest.conditionalFormats || rest.dataValidations ? rest : undefined;
}

/** The same entry re-addressed to another sheet name (rename / duplicate);
 *  `sources` replaces the positions (a copy names its own duplicate op). */
export function renamedRuleSet(entry: XlsxRuleSetEntry, sheetName: string, sources?: readonly number[]): XlsxRuleSetEntry {
  const own = sources === undefined ? {} : { sources };
  return {
    ...(entry.conditionalFormats ? { conditionalFormats: { ...entry.conditionalFormats, sheetName, ...own } } : {}),
    ...(entry.dataValidations ? { dataValidations: { ...entry.dataValidations, sheetName, ...own } } : {}),
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
