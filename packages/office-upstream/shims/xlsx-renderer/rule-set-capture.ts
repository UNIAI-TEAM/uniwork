import { CF_MUTATIONS, DV_MUTATIONS } from "../../upstream/apps/sheets/src/renderer/app-constants";
import { recordCfChange, recordDvChange } from "../../upstream/apps/sheets/src/renderer/edit-journal";
import type { LazyWorkbookState, UniverWorksheet } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { liveSessionSheets, type AxisRange, type RendererCommand } from "./edits";

// ── conditional formatting + data validation capture (X01) ─────────────────
//
// The pinned CF and DV presets each keep one rule model per sheet; every
// mutation in CF_MUTATIONS / DV_MUTATIONS changes it (the toolbar commands,
// undo/redo, and the plugins' own ref-range handlers that move rules after a
// row/column insert or remove). The save is declarative - the gateway
// rewrites the worksheet's whole <conditionalFormatting> / <dataValidations>
// section - so the capture reads the live model back at mutation time and
// emits one whole-sheet snapshot; the engine folds last-write-per-sheet.
// Univer's rule JSON is the wire format (the vendored collectCfStates /
// collectDvStates recipe); the gateway maps it strictly and fails closed.

export type XlsxRendererRuleSetKind = "conditionalFormats" | "dataValidations";

/** One rule of a snapshot: its areas plus the Univer rule object (CF rules
 *  also carry stopIfTrue). */
export interface XlsxRendererRuleSetRule {
  ranges: AxisRange[];
  stopIfTrue?: boolean;
  rule: Record<string, unknown>;
}

/** One whole-sheet rule-set snapshot (an empty list removes every rule).
 *  `sheetName` is stamped by the controller when it differs from the host
 *  file's. */
export interface XlsxRendererRuleSetEdit {
  sheetId: string;
  sheetName?: string;
  ruleSet: XlsxRendererRuleSetKind;
  rules: XlsxRendererRuleSetRule[];
}

/** The commands that change a rule model: the add/clear commands the
 *  toolbar fires plus the pinned commands those dispatch. */
export const RULE_SET_COMMANDS = new Set([
  "sheet.command.add-conditional-rule",
  "sheet.command.clear-range-conditional-rule",
  "sheet.command.clear-worksheet-conditional-rule",
  "sheet.command.addDataValidation",
  "sheets.command.clear-range-data-validation",
]);

interface RuleSetWorksheet {
  getConditionalFormattingRules?: () => { ranges: AxisRange[]; stopIfTrue?: boolean; rule: Record<string, unknown> }[];
  getDataValidations?: () => { rule: Record<string, unknown> & { ranges?: AxisRange[] } }[];
}

function area(range: AxisRange): AxisRange {
  return { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn };
}

/** JSON-only copy: the rule objects are model state and must not alias it. */
function plain(rule: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rule)) as Record<string, unknown>;
}

/** Snapshot one family's live rule model of a sheet. */
export function snapshotSheetRules(worksheet: UniverWorksheet, kind: XlsxRendererRuleSetKind): XlsxRendererRuleSetRule[] {
  const facade = worksheet as unknown as RuleSetWorksheet;
  if (kind === "conditionalFormats") {
    return (facade.getConditionalFormattingRules?.() ?? []).map((rule) => ({
      ranges: rule.ranges.map(area),
      stopIfTrue: rule.stopIfTrue === true,
      rule: plain(rule.rule),
    }));
  }
  return (facade.getDataValidations?.() ?? []).map(({ rule }) => {
    const { ranges, ...rest } = rule;
    return { ranges: (ranges ?? []).map(area), rule: plain(rest) };
  });
}

/** Ingest one CF/DV mutation into a whole-sheet rule-set edit. A mutation for
 *  another workbook, an unknown sheet, or with the journal suppressed (the
 *  file's own rules being installed) emits nothing. */
export function ingestRuleSetMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  worksheetFor: (sheetId: string) => UniverWorksheet | null,
  suppressed = false,
): XlsxRendererRuleSetEdit[] {
  const kind: XlsxRendererRuleSetKind | null = CF_MUTATIONS.has(event.id)
    ? "conditionalFormats"
    : DV_MUTATIONS.has(event.id) ? "dataValidations" : null;
  if (!state || suppressed || event.options?.fromFormula || kind === null) return [];
  const params = event.params as { unitId?: string; subUnitId?: string } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSessionSheets(state).some((sheet) => sheet.id === sheetId)) return [];
  if (ruleSetFamilyX14(state, sheetId, kind)) return [];
  const worksheet = worksheetFor(sheetId);
  if (!worksheet) return [];
  if (kind === "conditionalFormats") recordCfChange(state.editJournal, sheetId);
  else recordDvChange(state.editJournal, sheetId);
  return [{ sheetId, ruleSet: kind, rules: snapshotSheetRules(worksheet, kind) }];
}

/** What the file ships for one family on a sheet, as the views render-model
 *  bridge stamps it on the loader's sheet (`ruleSets`, absent on an older
 *  host = unknown): no rules, classic rules, or Excel extended (x14) rules
 *  the gateway's declarative save refuses to rewrite. */
type RuleSetFileState = "none" | "classic" | "x14" | "unknown";

function ruleSetFileState(state: LazyWorkbookState, sheetId: string, kind: XlsxRendererRuleSetKind): RuleSetFileState {
  const sheet = state.file.sheets.find((candidate) => candidate.id === sheetId) as
    { ruleSets?: Partial<Record<XlsxRendererRuleSetKind, unknown>> } | undefined;
  const value = sheet?.ruleSets?.[kind];
  return value === "none" || value === "classic" || value === "x14" ? value : "unknown";
}

/** An Excel x14 family on a file sheet: its edits are refused and its
 *  mutations (a row insert moving a data bar) are never snapshotted - the
 *  gateway shifts the file's blocks itself and keeps the x14 parts. */
function ruleSetFamilyX14(state: LazyWorkbookState, sheetId: string, kind: XlsxRendererRuleSetKind): boolean {
  return ruleSetFileState(state, sheetId, kind) === "x14";
}

/** A rule-set edit may only start once the sheet's file rules are installed
 *  in the live model; otherwise the declarative snapshot would drop them. The
 *  loader installs CF then DV in one pass and marks the sheet in
 *  `appliedDvSheets` even when it has no rules, so that set is the marker. A
 *  session-added sheet, or a family the file ships no rules for, has nothing
 *  to lose (review M2: a sheet the loader never installs - one structurally
 *  edited before its first render - is not locked for families it lacks).
 *  An x14 family is never ready. Readiness is re-read on every command, so a
 *  sheet that becomes ready later accepts the retry. */
export function ruleSetSheetReady(state: LazyWorkbookState, sheetId: string, kind: XlsxRendererRuleSetKind): boolean {
  if (!state.file.sheets.some((sheet) => sheet.id === sheetId)) return true;
  const fileState = ruleSetFileState(state, sheetId, kind);
  if (fileState === "x14") return false;
  return fileState === "none" || state.appliedDvSheets.has(sheetId);
}
