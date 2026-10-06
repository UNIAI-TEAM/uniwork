// UNI-953 - Excel's outline level buttons (1..n above the row / column
// headers). The pinned Univer has no outline model, so the levels live in the
// renderer's outline map (edits.ts) and a level click is planned here: every
// grouped line at or below the chosen level is shown, every deeper one is
// hidden through the allowlisted hidden/visible commands, and each group's
// summary line (the line after the group, Excel's default "summary below
// detail") gets the collapsed flag Excel draws "+" / "-" from.
import type { LazyWorkbookState } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { applyOutlineCollapse, type XlsxOutlineCollapseStep, type XlsxRendererEdit } from "./edits";

type OutlineEntries = ReadonlyMap<number, { level: number; collapsed: boolean }>;
export type OutlineAxis = "rows" | "cols";

/** Lines per axis on a sheet (Excel's grid), the bound a summary line obeys. */
const AXIS_LINES: Record<OutlineAxis, number> = { rows: 1_048_576, cols: 16_384 };

function entriesFor(state: LazyWorkbookState | null, sheetId: string, axis: OutlineAxis): OutlineEntries | undefined {
  const outline = state?.outline.get(sheetId);
  return axis === "rows" ? outline?.rows : outline?.cols;
}

/** The deepest outline level on an axis (0: no outline, no buttons). The
 *  level buttons are 1..max+1: button 1 shows only ungrouped lines, the last
 *  one shows every line. */
export function outlineMaxLevel(entries: OutlineEntries | undefined): number {
  let max = 0;
  for (const entry of entries?.values() ?? []) {
    if (entry.level > max) max = Math.min(7, entry.level);
  }
  return max;
}

/** Both axes' deepest levels on a sheet, the bar's input. */
export function outlineMaxLevels(state: LazyWorkbookState | null, sheetId: string | undefined): { rows: number; cols: number } {
  if (!sheetId) return { rows: 0, cols: 0 };
  return {
    rows: outlineMaxLevel(entriesFor(state, sheetId, "rows")),
    cols: outlineMaxLevel(entriesFor(state, sheetId, "cols")),
  };
}

export interface OutlineLevelPlan {
  /** Contiguous spans to hide / show (only lines whose state changes). */
  readonly hide: ReadonlyArray<{ start: number; end: number }>;
  readonly show: ReadonlyArray<{ start: number; end: number }>;
  /** Every group's summary line and the flag it takes at this level. */
  readonly collapsed: ReadonlyArray<{ line: number; collapsed: boolean }>;
}

/** What clicking level button `level` does (Excel): a grouped line stays
 *  visible when its level is below `level` and hides otherwise; ungrouped
 *  lines are never touched (a hand-hidden line stays hidden). A group at
 *  depth d is collapsed when d >= level; a summary line closing several
 *  nested groups carries the outermost one's flag (the button Excel draws
 *  there). `isHidden` reads the live grid so unchanged lines run nothing. */
export function planOutlineLevel(
  entries: OutlineEntries | undefined,
  level: number,
  axis: OutlineAxis,
  isHidden: (line: number) => boolean,
): OutlineLevelPlan {
  const grouped = [...(entries?.entries() ?? [])]
    .filter(([, entry]) => entry.level > 0)
    .sort(([a], [b]) => a - b);
  const hide: Array<{ start: number; end: number }> = [];
  const show: Array<{ start: number; end: number }> = [];
  const push = (spans: Array<{ start: number; end: number }>, line: number): void => {
    const last = spans.at(-1);
    if (last && last.end === line - 1) last.end = line;
    else spans.push({ start: line, end: line });
  };
  const collapsed: Array<{ line: number; collapsed: boolean }> = [];
  for (let index = 0; index < grouped.length; index += 1) {
    const [line, entry] = grouped[index]!;
    const own = Math.min(7, entry.level);
    const target = own >= level;
    if (target !== isHidden(line)) push(target ? hide : show, line);
    // Groups at depths (next, own] end on this line, where `next` is the
    // following line's level (0 across a gap): the outermost is next + 1.
    const following = grouped[index + 1];
    const next = following && following[0] === line + 1 ? Math.min(7, following[1].level) : 0;
    if (own > next && line + 1 < AXIS_LINES[axis]) collapsed.push({ line: line + 1, collapsed: next + 1 >= level });
  }
  return { hide, show, collapsed };
}

/** What a level click needs from the controller: the journal state, the unit,
 *  the live hidden flag of a line, a synchronous allowlisted command run (the
 *  policy gate still applies), the edit channel and the undo stack. */
export interface OutlineLevelHost {
  state: LazyWorkbookState | null;
  unitId: string;
  isHidden(line: number): boolean;
  execute(id: string, params: object): boolean;
  emit(edits: XlsxRendererEdit[]): boolean;
  pushUndo(item: { unitID: string; undoMutations: XlsxOutlineCollapseStep[]; redoMutations: XlsxOutlineCollapseStep[] }): void;
}

const HIDE_COMMAND: Record<OutlineAxis, string> = { rows: "sheet.command.set-rows-hidden", cols: "sheet.command.set-col-hidden" };
const SHOW_COMMAND: Record<OutlineAxis, string> = {
  rows: "sheet.command.set-specific-rows-visible",
  cols: "sheet.command.set-col-visible-on-cols",
};

function axisRanges(axis: OutlineAxis, spans: ReadonlyArray<{ start: number; end: number }>) {
  return spans.map(({ start, end }) => axis === "rows"
    ? { startRow: start, endRow: end, startColumn: 0, endColumn: 0, rangeType: 1 }
    : { startRow: 0, endRow: 0, startColumn: start, endColumn: end, rangeType: 2 });
}

/** Runs one level click: hide, then show, then the summary flags, every
 *  change journalled (the hidden/visible commands through the mutation
 *  channel, the flags as outline ops) with one undo entry for the flags. The
 *  caller folds the whole click into one undo step. A sheet without an
 *  outline on the axis, or a level past the last button, changes nothing.
 *  False only when a hidden/visible command is refused. */
export function runOutlineLevel(host: OutlineLevelHost, sheetId: string, axis: OutlineAxis, level: number): boolean {
  if (!Number.isInteger(level) || level < 1 || level > 8) return false;
  if (!host.state?.file.sheets.some((sheet) => sheet.id === sheetId)) return false;
  const entries = entriesFor(host.state, sheetId, axis);
  const max = outlineMaxLevel(entries);
  if (max === 0) return true;
  const plan = planOutlineLevel(entries, Math.min(level, max + 1), axis, host.isHidden);
  for (const [spans, ids] of [[plan.hide, HIDE_COMMAND], [plan.show, SHOW_COMMAND]] as const) {
    if (spans.length === 0) continue;
    if (!host.execute(ids[axis], { unitId: host.unitId, subUnitId: sheetId, ranges: axisRanges(axis, spans) })) return false;
  }
  const changed: Array<{ line: number; collapsed: boolean }> = [];
  const edits: XlsxRendererEdit[] = [];
  for (const flag of plan.collapsed) {
    const written = applyOutlineCollapse(host.state, sheetId, axis, flag.line, flag.collapsed);
    if (written.length === 0) continue;
    changed.push(flag);
    edits.push(...written);
  }
  if (host.emit(edits)) {
    const step = (line: number, collapsed: boolean): XlsxOutlineCollapseStep => ({
      id: "uniwork.command.set-outline-collapsed",
      params: { subUnitId: sheetId, axis, start: line, end: line, collapsed, history: false },
    });
    host.pushUndo({
      unitID: host.unitId,
      undoMutations: changed.map((flag) => step(flag.line, !flag.collapsed)),
      redoMutations: changed.map((flag) => step(flag.line, flag.collapsed)),
    });
  }
  return true;
}
