import { CF_MUTATIONS, DV_MUTATIONS } from "../../upstream/apps/sheets/src/renderer/app-constants";
import type { LazyWorkbookState } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { liveSessionSheets, type RendererCommand } from "./edits";
import { RULE_SET_COMMANDS, ruleSetSheetReady, type XlsxRendererRuleSetKind } from "./rule-set-capture";
import { cfRuleSaveable, dvRuleSaveable } from "./rule-set-saveable";

// ── conditional formatting + data validation (X01) ─────────────────────────
//
// Exactly the pinned CF/DV commands the Home-tab Conditional Formatting group
// and the Data-tab Data Validation group fire, plus the rule mutations those
// commands, undo/redo and the plugins' ref-range handlers dispatch. Every
// rule-set change is saved as a whole-sheet snapshot (rule-set-capture.ts),
// so a command is refused until the sheet's file rules are installed in the
// live model (never on a sheet whose family carries Excel x14 rules the save
// cannot rewrite), and a new rule must be one the gateway can write: bounded,
// ordered in-grid areas; a CF rule the gateway's own serializer dry-run
// accepts (cfRuleUnsaveableReason, zero drift); a DV type, operator and error
// style xlsx-dv.ts maps.

const MAX_RULE_AREAS = 1_000;

function areaOK(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const area = value as Record<string, unknown>;
  if (![area.startRow, area.endRow, area.startColumn, area.endColumn].every(
    (bound) => typeof bound === "number" && Number.isInteger(bound) && bound >= 0)) return false;
  const { startRow, endRow, startColumn, endColumn } =
    area as { startRow: number; endRow: number; startColumn: number; endColumn: number };
  return startRow <= endRow && startColumn <= endColumn && endRow < 1_048_576 && endColumn < 16_384;
}

function areasOK(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_RULE_AREAS && value.every(areaOK);
}

interface RuleSetParams {
  unitId?: unknown;
  subUnitId?: unknown;
  ranges?: unknown;
  rule?: unknown;
}

/** The commands are sheet-scoped: an explicit unit must be this workbook, and
 *  the sheet (required - the toolbar always names it) must be live and have
 *  its file rules installed. */
function ruleSetScopeOK(
  params: RuleSetParams | undefined,
  state: LazyWorkbookState,
  kind: XlsxRendererRuleSetKind,
): params is RuleSetParams & { subUnitId: string } {
  if (!params || typeof params !== "object") return false;
  if (params.unitId !== undefined && params.unitId !== `file-${state.file.sha256}`) return false;
  return typeof params.subUnitId === "string" &&
    liveSessionSheets(state).some((sheet) => sheet.id === params.subUnitId) &&
    ruleSetSheetReady(state, params.subUnitId, kind);
}

function newRuleOK(rule: unknown, family: "cf" | "dv"): boolean {
  if (!rule || typeof rule !== "object") return false;
  const shape = rule as { ranges?: unknown; rule?: unknown; type?: unknown; stopIfTrue?: unknown };
  if (!areasOK(shape.ranges)) return false;
  if (family === "dv") return dvRuleSaveable(shape);
  if (shape.stopIfTrue !== undefined && typeof shape.stopIfTrue !== "boolean") return false;
  return cfRuleSaveable(shape.rule);
}

export function isRuleSetCommand(id: string): boolean {
  return RULE_SET_COMMANDS.has(id);
}

export function isRuleSetMutation(id: string): boolean {
  return CF_MUTATIONS.has(id) || DV_MUTATIONS.has(id);
}

export function ruleSetCommandAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as RuleSetParams | undefined;
  const kind: XlsxRendererRuleSetKind = event.id.includes("conditional") ? "conditionalFormats" : "dataValidations";
  if (!ruleSetScopeOK(params, state, kind)) return false;
  switch (event.id) {
    case "sheet.command.add-conditional-rule":
      return newRuleOK(params.rule, "cf");
    case "sheet.command.addDataValidation":
      return newRuleOK(params.rule, "dv");
    case "sheets.command.clear-range-data-validation":
      return areasOK(params.ranges);
    case "sheet.command.clear-range-conditional-rule":
      // Selection-driven in the pinned handler: explicit ranges are optional
      // and bounded when present.
      return params.ranges === undefined || areasOK(params.ranges);
    case "sheet.command.clear-worksheet-conditional-rule":
      return true;
  }
  return false;
}

/** Rule mutations replay through undo/redo and the ref-range handlers; they
 *  only need to address a live sheet of this workbook. */
export function ruleSetMutationAllowed(event: RendererCommand, state: LazyWorkbookState): boolean {
  const params = event.params as { unitId?: unknown; subUnitId?: unknown } | undefined;
  return !!params && typeof params === "object" && params.unitId === `file-${state.file.sha256}` &&
    typeof params.subUnitId === "string" && liveSessionSheets(state).some((sheet) => sheet.id === params.subUnitId);
}

/** A host restore after a dropped save (r3 MA-3) passes the same gate as the
 *  rule mutations it dispatches: a live sheet of this workbook, a known
 *  family, and, when the host names the rules, bounded in-grid areas and a
 *  rule object for each (null restores the file's installed rules). */
export function ruleSetRestoreAllowed(state: LazyWorkbookState, sheetId: unknown, kind: unknown, rules: unknown): boolean {
  if (kind !== "conditionalFormats" && kind !== "dataValidations") return false;
  if (typeof sheetId !== "string" || !liveSessionSheets(state).some((sheet) => sheet.id === sheetId)) return false;
  if (rules === null) return true;
  return Array.isArray(rules) && rules.length <= MAX_RULE_AREAS && rules.every((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const shape = entry as { ranges?: unknown; rule?: unknown; stopIfTrue?: unknown };
    return areasOK(shape.ranges) && !!shape.rule && typeof shape.rule === "object" &&
      (shape.stopIfTrue === undefined || typeof shape.stopIfTrue === "boolean");
  });
}
