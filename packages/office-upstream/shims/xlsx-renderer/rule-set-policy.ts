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
  cfId?: unknown;
  ruleId?: unknown;
  start?: unknown;
  end?: unknown;
  setting?: unknown;
  options?: unknown;
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
    // The rule managers (UNI-953): edit, reorder and delete one rule by its
    // model id. An edited rule passes the same dry-run as a new one.
    case "sheet.command.set-conditional-rule":
      return idOK(params.cfId) && newRuleOK(params.rule, "cf") && (params.rule as { cfId?: unknown }).cfId === params.cfId;
    case "sheet.command.move-conditional-rule":
      return anchorOK(params.start, ["self"]) && anchorOK(params.end, ["before", "after"]);
    case "sheet.command.delete-conditional-rule":
      return idOK(params.cfId);
    case "sheets.command.update-data-validation-setting":
      return idOK(params.ruleId) && !!params.setting && typeof params.setting === "object" && dvRuleSaveable(params.setting);
    case "sheets.command.update-data-validation-options":
      return idOK(params.ruleId) && dvOptionsOK(params.options);
    case "sheet.command.updateDataValidationRuleRange":
      return idOK(params.ruleId) && areasOK(params.ranges);
    case "sheet.command.remove-data-validation-rule":
      return idOK(params.ruleId);
  }
  return false;
}

/** The model ids a rule-manager command addresses, or null for the commands
 *  that address areas instead (add, clear). */
function ruleManagerTargets(event: RendererCommand): string[] | null {
  const params = event.params as RuleSetParams | undefined;
  switch (event.id) {
    case "sheet.command.set-conditional-rule":
    case "sheet.command.delete-conditional-rule":
      return [params?.cfId as string];
    case "sheet.command.move-conditional-rule":
      return [(params?.start as { id?: string } | undefined)?.id as string, (params?.end as { id?: string } | undefined)?.id as string];
    case "sheets.command.update-data-validation-setting":
    case "sheets.command.update-data-validation-options":
    case "sheet.command.updateDataValidationRuleRange":
    case "sheet.command.remove-data-validation-rule":
      return [params?.ruleId as string];
  }
  return null;
}

/** A rule-manager command must address rules the sheet's live model holds
 *  (review dvcf F2): the pinned remove-DV handler "succeeds" on an unknown id
 *  and pushes an undo that inserts an empty rule. `liveIds` reads the live
 *  model (readLiveRuleSet); null = no such sheet. Runs after
 *  ruleSetCommandAllowed, which already checked the params' shapes. */
export function ruleSetTargetsLive(
  event: RendererCommand,
  liveIds: (sheetId: string, kind: XlsxRendererRuleSetKind) => readonly string[] | null,
): boolean {
  const targets = ruleManagerTargets(event);
  if (targets === null) return true;
  const sheetId = (event.params as RuleSetParams | undefined)?.subUnitId;
  if (typeof sheetId !== "string") return false;
  const live = liveIds(sheetId, event.id.includes("conditional") ? "conditionalFormats" : "dataValidations");
  return !!live && targets.every((id) => typeof id === "string" && live.includes(id));
}

const MAX_RULE_ID = 200;

function idOK(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_RULE_ID;
}

function anchorOK(value: unknown, types: readonly string[]): boolean {
  if (!value || typeof value !== "object") return false;
  const anchor = value as { id?: unknown; type?: unknown };
  return idOK(anchor.id) && typeof anchor.type === "string" && types.includes(anchor.type);
}

/** The option keys the DV rule manager sends. Any other key (prompt,
 *  promptTitle, showDropDown, renderMode, …) is refused: nothing bounds it
 *  here, and an unbounded prompt would fail the save (review dvcf F5). */
const DV_OPTION_KEYS = new Set(["errorStyle", "error", "errorTitle", "showErrorMessage"]);

/** DV options: an error style xlsx-dv.ts maps, bounded message strings and a
 *  boolean alert flag, and nothing else. */
function dvOptionsOK(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.keys(value).some((key) => !DV_OPTION_KEYS.has(key))) return false;
  const options = value as { errorStyle?: unknown; error?: unknown; errorTitle?: unknown; showErrorMessage?: unknown };
  const textOK = (field: unknown, max: number) => field === undefined || (typeof field === "string" && field.length <= max);
  return dvRuleSaveable({ type: "any", errorStyle: options.errorStyle }) && textOK(options.error, 255) &&
    textOK(options.errorTitle, 32) && (options.showErrorMessage === undefined || typeof options.showErrorMessage === "boolean");
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
