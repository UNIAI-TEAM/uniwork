// UNI-964 - Excel's per-group outline brackets: the line beside each row /
// column group and the "+" / "-" toggle on its summary line. The groups come
// from the renderer's outline map (edits.ts); the summary line is the one
// after the group (Excel's default "summary below / right": the model carries
// no summaryBelow / summaryRight, so the default is the only placement). A
// toggle hides or shows THAT group through the same allowlisted hidden /
// visible commands and summary flag a level click uses (outline-levels.ts),
// so the save path is the one Hide / Show Detail already writes.
import type { LazyWorkbookState } from "../../upstream/apps/sheets/src/renderer/univer-state";
import {
  AXIS_LINES,
  entriesFor,
  runOutlinePlan,
  type OutlineAxis,
  type OutlineLevelHost,
  type OutlineLevelPlan,
} from "./outline-levels";

type OutlineEntries = ReadonlyMap<number, { level: number; collapsed: boolean }>;

/** One group: a maximal run of lines at `depth` or deeper. */
export interface OutlineGroup {
  readonly start: number;
  readonly end: number;
  readonly depth: number;
  /** The line the toggle sits on; null for a group ending at the grid edge. */
  readonly summary: number | null;
}

/** Every group on an axis, ordered by start then depth (outer first). */
export function outlineGroups(entries: OutlineEntries | undefined, axis: OutlineAxis): OutlineGroup[] {
  const lines = [...(entries?.entries() ?? [])]
    .filter(([, entry]) => entry.level > 0)
    .map(([line, entry]) => [line, Math.min(7, entry.level)] as const)
    .sort(([a], [b]) => a - b);
  const groups: OutlineGroup[] = [];
  const open: number[] = [];
  let previous = -2;
  let previousLevel = 0;
  const close = (above: number, end: number): void => {
    while (open.length > above) {
      const depth = open.length;
      const start = open.pop()!;
      groups.push({ start, end, depth, summary: end + 1 < AXIS_LINES[axis] ? end + 1 : null });
    }
  };
  for (const [line, level] of lines) {
    if (line !== previous + 1) close(0, previous);
    else close(level, previous);
    while (open.length < level) open.push(line);
    previous = line;
    previousLevel = level;
  }
  if (previousLevel > 0) close(0, previous);
  return groups.sort((a, b) => a.start - b.start || a.depth - b.depth);
}

/** A group reads collapsed when none of its lines is on screen (Excel's "+"). */
export function groupCollapsed(group: OutlineGroup, isHidden: (line: number) => boolean): boolean {
  for (let line = group.start; line <= group.end; line += 1) {
    if (!isHidden(line)) return false;
  }
  return true;
}

/** What one toggle does. Collapse hides every visible line of the group and
 *  sets its summary flag. Expand shows the group's hidden lines but leaves a
 *  nested group that was collapsed on its own (its summary flag, when that
 *  summary line is inside this group) hidden, as Excel does, and clears the
 *  flag. Lines already in the target state run nothing. */
export function planOutlineGroup(
  entries: OutlineEntries | undefined,
  group: OutlineGroup,
  collapse: boolean,
  axis: OutlineAxis,
  isHidden: (line: number) => boolean,
): OutlineLevelPlan {
  const keep = new Set<number>();
  if (!collapse) {
    for (const child of outlineGroups(entries, axis)) {
      if (child.depth <= group.depth || child.start < group.start || child.end > group.end) continue;
      if (child.summary === null || child.summary === group.summary) continue;
      if (entries?.get(child.summary)?.collapsed !== true) continue;
      for (let line = child.start; line <= child.end; line += 1) keep.add(line);
    }
  }
  const spans: Array<{ start: number; end: number }> = [];
  for (let line = group.start; line <= group.end; line += 1) {
    if (keep.has(line) || isHidden(line) === collapse) continue;
    const last = spans.at(-1);
    if (last && last.end === line - 1) last.end = line;
    else spans.push({ start: line, end: line });
  }
  return {
    hide: collapse ? spans : [],
    show: collapse ? [] : spans,
    collapsed: group.summary === null ? [] : [{ line: group.summary, collapsed: collapse }],
  };
}

/** Runs one toggle for the group starting at `start` at `depth`. A group
 *  that no longer exists (the outline changed under a stale button) changes
 *  nothing; false only for bad input or a refused hidden/visible command. */
export function runOutlineGroup(
  host: OutlineLevelHost,
  sheetId: string,
  axis: OutlineAxis,
  start: number,
  depth: number,
  collapse: boolean,
): boolean {
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(depth) || depth < 1 || depth > 7) return false;
  if (!host.state?.file.sheets.some((sheet) => sheet.id === sheetId)) return false;
  const entries = entriesFor(host.state, sheetId, axis);
  const group = outlineGroups(entries, axis).find((candidate) => candidate.start === start && candidate.depth === depth);
  if (!group) return true;
  return runOutlinePlan(host, sheetId, axis, planOutlineGroup(entries, group, collapse, axis, host.isHidden));
}

/** Where a line is drawn along its axis, in renderer-container pixels. */
export interface OutlineLineBox {
  readonly start: number;
  readonly size: number;
}

/** The measurements a layout reads from the grid on screen. */
export interface OutlineMeasure {
  box(axis: OutlineAxis, line: number): OutlineLineBox | null;
  /** Line ranges on screen per axis (a frozen band and the scrolling pane). */
  visible(axis: OutlineAxis): ReadonlyArray<{ start: number; end: number }>;
  isHidden(axis: OutlineAxis, line: number): boolean;
}

/** One bracket as the gutter draws it. `line` is the bracket's extent along
 *  the axis (null when collapsed or scrolled away), `button` the toggle's
 *  centre (null when its summary line is not on screen). */
export interface OutlineBracket {
  readonly key: string;
  readonly group: OutlineGroup;
  readonly collapsed: boolean;
  readonly line: { readonly from: number; readonly to: number } | null;
  readonly button: number | null;
}

/** The brackets of the groups on screen. Positions before the first line on
 *  screen (under the header or the frozen band's edge) are clipped. */
export function layoutOutlineBrackets(
  state: LazyWorkbookState | null,
  sheetId: string | undefined,
  axis: OutlineAxis,
  measure: OutlineMeasure,
): OutlineBracket[] {
  if (!sheetId) return [];
  const groups = outlineGroups(entriesFor(state, sheetId, axis), axis);
  if (groups.length === 0) return [];
  const windows = measure.visible(axis);
  if (windows.length === 0) return [];
  const first = Math.min(...windows.map((window) => window.start));
  const clip = measure.box(axis, first)?.start;
  if (clip === undefined) return [];
  const hidden = (line: number): boolean => measure.isHidden(axis, line);
  const brackets: OutlineBracket[] = [];
  for (const group of groups) {
    const last = group.summary ?? group.end;
    if (!windows.some((window) => group.start <= window.end && last >= window.start)) continue;
    const collapsed = groupCollapsed(group, hidden);
    const summaryBox = group.summary === null ? null : measure.box(axis, group.summary);
    const shown = summaryBox && summaryBox.size > 0 && !hidden(group.summary!) ? summaryBox : null;
    const button = shown && shown.start + shown.size / 2 >= clip ? shown.start + shown.size / 2 : null;
    let line: OutlineBracket["line"] = null;
    if (!collapsed) {
      const startBox = measure.box(axis, group.start);
      const endBox = shown ?? measure.box(axis, group.end);
      if (startBox && endBox) {
        const from = Math.max(clip, startBox.start);
        const to = shown ? shown.start + shown.size / 2 : endBox.start + endBox.size;
        if (to > from) line = { from, to };
      }
    }
    if (!line && button === null) continue;
    brackets.push({ key: `${axis}:${group.start}:${group.depth}`, group, collapsed, line, button });
  }
  return brackets;
}
