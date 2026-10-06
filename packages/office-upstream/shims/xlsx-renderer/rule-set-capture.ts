import { CF_MUTATIONS, DV_MUTATIONS } from "../../upstream/apps/sheets/src/renderer/app-constants";
import { recordCfChange, recordDvChange } from "../../upstream/apps/sheets/src/renderer/edit-journal";
import type { LazyWorkbookState, UniverWorksheet } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { liveSessionSheets, type AxisRange, type RendererCommand } from "./edits";
import { cfRuleSaveable, dvRuleSaveable } from "./rule-set-saveable";

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
 *  file's own rules being installed) emits nothing; a suppressed install is
 *  counted and dry-run instead (review r2 M-B). A family that is refused on
 *  its sheet (x14, a file rule the live model lacks or the save cannot
 *  re-serialize, or a duplicate of such a sheet) emits nothing either, so the
 *  gateway keeps or shifts the file's blocks itself. */
export function ingestRuleSetMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  worksheetFor: (sheetId: string) => UniverWorksheet | null,
  suppressed = false,
): XlsxRendererRuleSetEdit[] {
  if (state) observeRuleSetEvent(state, event, suppressed);
  const kind: XlsxRendererRuleSetKind | null = CF_MUTATIONS.has(event.id)
    ? "conditionalFormats"
    : DV_MUTATIONS.has(event.id) ? "dataValidations" : null;
  if (!state || suppressed || event.options?.fromFormula || kind === null) return [];
  const params = event.params as { unitId?: string; subUnitId?: string } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !liveSessionSheets(state).some((sheet) => sheet.id === sheetId)) return [];
  if (ruleSetFamilyState(state, sheetId, kind) === "refused") return [];
  const worksheet = worksheetFor(sheetId);
  if (!worksheet) return [];
  if (kind === "conditionalFormats") recordCfChange(state.editJournal, sheetId);
  else recordDvChange(state.editJournal, sheetId);
  return [{ sheetId, ruleSet: kind, rules: snapshotSheetRules(worksheet, kind) }];
}

/** What the file ships for one family on a sheet, as the views render-model
 *  bridge stamps it on the loader's sheet (`ruleSets`, absent on an older
 *  host = unknown): no rules, classic rules, or Excel extended (x14) rules
 *  the gateway's declarative save refuses to rewrite. The bridge also stamps
 *  `ruleCounts`, the file's raw <cfRule> / <dataValidation> element count. */
type RuleSetFileState = "none" | "classic" | "x14" | "unknown";

interface RuleSetFileSheet {
  ruleSets?: Partial<Record<XlsxRendererRuleSetKind, unknown>>;
  ruleCounts?: Partial<Record<XlsxRendererRuleSetKind, unknown>>;
}

function fileSheet(state: LazyWorkbookState, sheetId: string): RuleSetFileSheet | undefined {
  return state.file.sheets.find((candidate) => candidate.id === sheetId) as RuleSetFileSheet | undefined;
}

function ruleSetFileState(state: LazyWorkbookState, sheetId: string, kind: XlsxRendererRuleSetKind): RuleSetFileState {
  const value = fileSheet(state, sheetId)?.ruleSets?.[kind];
  return value === "none" || value === "classic" || value === "x14" ? value : "unknown";
}

function fileRuleCount(state: LazyWorkbookState, sheetId: string, kind: XlsxRendererRuleSetKind): number | undefined {
  const value = fileSheet(state, sheetId)?.ruleCounts?.[kind];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** ready: edits allowed and snapshotted. pending: the loader has not installed
 *  the file rules yet (refused, retried on the next command). refused: never
 *  editable this session, and mutations (a row insert moving a rule) are not
 *  snapshotted - the gateway keeps or shifts the file's blocks itself. */
type RuleSetFamilyState = "ready" | "pending" | "refused";

/** Per workbook state: what the capture saw of the loader's installs (review
 *  r2 M-B) and of sheet copies (M-C). */
interface RuleSetTrack {
  /** File sheets the capture saw events for before the loader marked them;
   *  only their install counts are complete. */
  watched: Set<string>;
  /** Per sheet and family: installed file rules the save can re-serialize. */
  installed: Map<string, Partial<Record<XlsxRendererRuleSetKind, number>>>;
  /** Per sheet: families with an installed file rule the save cannot write. */
  unsaveable: Map<string, Set<XlsxRendererRuleSetKind>>;
  /** Per duplicated sheet: each family's state at the moment of the copy. */
  inherited: Map<string, Record<XlsxRendererRuleSetKind, RuleSetFamilyState>>;
}

const tracks = new WeakMap<LazyWorkbookState, RuleSetTrack>();
const RULE_SET_KINDS: readonly XlsxRendererRuleSetKind[] = ["conditionalFormats", "dataValidations"];
/** The mutation the loader dispatches per file rule it installs. */
const INSTALL_MUTATIONS: Readonly<Record<string, XlsxRendererRuleSetKind>> = {
  "sheet.mutation.add-conditional-rule": "conditionalFormats",
  "data-validation.mutation.addRule": "dataValidations",
};

function trackOf(state: LazyWorkbookState): RuleSetTrack {
  let track = tracks.get(state);
  if (!track) {
    track = { watched: new Set(), installed: new Map(), unsaveable: new Map(), inherited: new Map() };
    tracks.set(state, track);
  }
  return track;
}

function installedRuleSaveable(kind: XlsxRendererRuleSetKind, rule: unknown): boolean {
  if (kind === "dataValidations") return dvRuleSaveable(rule);
  return !!rule && typeof rule === "object" && cfRuleSaveable((rule as { rule?: unknown }).rule);
}

/** Every renderer event passes here before the snapshot logic: it marks the
 *  file sheets still waiting for their rules, counts and dry-runs each file
 *  rule the loader installs (a suppressed add mutation), and stamps a sheet
 *  copy with its source's family states (the copy's insert mutation follows
 *  the sheet journal, which already names the source). */
function observeRuleSetEvent(state: LazyWorkbookState, event: RendererCommand, suppressed: boolean): void {
  const track = trackOf(state);
  for (const sheet of state.file.sheets) if (!state.appliedDvSheets.has(sheet.id)) track.watched.add(sheet.id);
  const params = event.params as { unitId?: unknown; subUnitId?: unknown; rule?: unknown; sheet?: { id?: unknown } } | undefined;
  if (!params || typeof params !== "object" || params.unitId !== `file-${state.file.sha256}`) return;
  const kind = INSTALL_MUTATIONS[event.id];
  if (suppressed && kind !== undefined && typeof params.subUnitId === "string") {
    const sheetId = params.subUnitId;
    if (installedRuleSaveable(kind, params.rule)) {
      const counts = track.installed.get(sheetId) ?? {};
      counts[kind] = (counts[kind] ?? 0) + 1;
      track.installed.set(sheetId, counts);
    } else {
      const families = track.unsaveable.get(sheetId) ?? new Set<XlsxRendererRuleSetKind>();
      families.add(kind);
      track.unsaveable.set(sheetId, families);
    }
    return;
  }
  const copyId = event.id === "sheet.mutation.insert-sheet" ? params.sheet?.id : undefined;
  if (typeof copyId !== "string" || track.inherited.has(copyId)) return;
  const sourceId = state.editJournal.sheets.added.get(copyId)?.sourceSheetId;
  if (sourceId === undefined) return;
  // The copy holds what the live model held for the source at this moment,
  // and the gateway duplicates the source's XML: only a ready family stays
  // ready (a pending source never fills the copy's model).
  const inherited = {} as Record<XlsxRendererRuleSetKind, RuleSetFamilyState>;
  for (const family of RULE_SET_KINDS) {
    inherited[family] = ruleSetFamilyState(state, sourceId, family) === "ready" ? "ready" : "refused";
  }
  track.inherited.set(copyId, inherited);
}

/** A rule-set edit may only start once the sheet's file rules are installed
 *  in the live model; otherwise the declarative snapshot would drop them. The
 *  loader installs CF then DV in one pass and marks the sheet in
 *  `appliedDvSheets` even when it has no rules, so that set is the marker. A
 *  family the file ships no rules for has nothing to lose (review M2). An x14
 *  family is refused, and so is a family whose installed file rules fall short
 *  of the file's raw count (the loader skipped one - a "Dates occurring" rule,
 *  a shadowed data bar, a rule without a priority) or include one the save
 *  cannot re-serialize (review r2 M-B): the snapshot would silently delete or
 *  fail on it. A duplicate inherits its source's state at the copy (M-C); any
 *  other session-added sheet is ready. */
function ruleSetFamilyState(state: LazyWorkbookState, sheetId: string, kind: XlsxRendererRuleSetKind): RuleSetFamilyState {
  const track = tracks.get(state);
  if (!state.file.sheets.some((sheet) => sheet.id === sheetId)) return track?.inherited.get(sheetId)?.[kind] ?? "ready";
  const fileState = ruleSetFileState(state, sheetId, kind);
  if (fileState === "x14") return "refused";
  if (fileState === "none") return "ready";
  if (!state.appliedDvSheets.has(sheetId)) return "pending";
  // Installed before the capture listened: the counts are unknown (pre-r2).
  if (!track?.watched.has(sheetId)) return "ready";
  if (track.unsaveable.get(sheetId)?.has(kind)) return "refused";
  const expected = fileRuleCount(state, sheetId, kind);
  return expected === undefined || (track.installed.get(sheetId)?.[kind] ?? 0) === expected ? "ready" : "refused";
}

/** Readiness is re-read on every command, so a pending sheet that the loader
 *  installs later accepts the retry. */
export function ruleSetSheetReady(state: LazyWorkbookState, sheetId: string, kind: XlsxRendererRuleSetKind): boolean {
  return ruleSetFamilyState(state, sheetId, kind) === "ready";
}
