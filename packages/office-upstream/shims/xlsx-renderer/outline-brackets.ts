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
  invalidateOutlineCache,
  memoOutline,
  runOutlinePlan,
  type OutlineAxis,
  type OutlineLevelHost,
  type OutlineLevelPlan,
  type OutlineMemo,
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

const groupsMemo: Record<OutlineAxis, OutlineMemo<OutlineGroup[]>> = { rows: new WeakMap(), cols: new WeakMap() };

/** outlineGroups, cached per entries map until the levels change
 *  (outline-levels.ts memoOutline): a scroll frame never re-sorts the axis. */
export function cachedOutlineGroups(entries: OutlineEntries | undefined, axis: OutlineAxis): readonly OutlineGroup[] {
  if (!entries) return [];
  return memoOutline(groupsMemo[axis], entries, (lines) => outlineGroups(lines, axis));
}

/** How many lines a layout reads at most for one group's hidden walk or its
 *  nearest-visible-line search, so a frame stays bounded on any sheet. */
const SCAN_LIMIT = 512;

/** Collapsed by its own toggle: the summary flag is set and the group's first
 *  and last lines are hidden. O(1); a flag left set while the lines were shown
 *  by another path (Unhide rows) reads expanded. */
function groupFolded(group: OutlineGroup, entries: OutlineEntries | undefined, isHidden: (line: number) => boolean): boolean {
  return group.summary !== null && entries?.get(group.summary)?.collapsed === true &&
    isHidden(group.start) && isHidden(group.end);
}

/** A group reads collapsed (Excel's "+") when its lines are hidden: its own
 *  flag plus hidden first and last lines, or, without a flag (hidden by hand,
 *  or a group at the grid edge, which has no summary line to flag), hidden
 *  first and last lines and no shown line among the ones on screen (`windows`,
 *  the whole group when omitted), read up to SCAN_LIMIT lines. */
export function groupCollapsed(
  group: OutlineGroup,
  entries: OutlineEntries | undefined,
  isHidden: (line: number) => boolean,
  windows: ReadonlyArray<{ start: number; end: number }> = [group],
): boolean {
  if (!isHidden(group.start) || !isHidden(group.end)) return false;
  if (groupFolded(group, entries, isHidden)) return true;
  let budget = SCAN_LIMIT;
  for (const window of windows) {
    for (let line = Math.max(group.start + 1, window.start); line <= Math.min(group.end - 1, window.end); line += 1) {
      if (budget-- <= 0) return true;
      if (!isHidden(line)) return false;
    }
  }
  return true;
}

/** What one toggle does. Collapse hides every visible line of the group and
 *  sets its summary flag; a nested group whose flag is still set but whose
 *  lines are shown (another path showed them without clearing it) gets the
 *  flag cleared in the same step, so only a nested group that was collapsed
 *  before the parent folded carries one. Expand shows the group's hidden
 *  lines but leaves those flagged nested groups (summary line inside this
 *  group) hidden, as Excel does, and clears the group's flag. Lines already
 *  in the target state run nothing. */
export function planOutlineGroup(
  entries: OutlineEntries | undefined,
  group: OutlineGroup,
  collapse: boolean,
  axis: OutlineAxis,
  isHidden: (line: number) => boolean,
): OutlineLevelPlan {
  const keep = new Set<number>();
  const stale: Array<{ line: number; collapsed: boolean }> = [];
  for (const child of cachedOutlineGroups(entries, axis)) {
    if (child.start > group.end) break;
    if (child.depth <= group.depth || child.start < group.start || child.end > group.end) continue;
    if (child.summary === null || child.summary === group.summary) continue;
    if (entries?.get(child.summary)?.collapsed !== true) continue;
    if (collapse) {
      if (!groupFolded(child, entries, isHidden)) stale.push({ line: child.summary, collapsed: false });
    } else {
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
    collapsed: [...stale, ...(group.summary === null ? [] : [{ line: group.summary, collapsed: collapse }])],
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
  // A click walks the group anyway; it never trusts a cached derivation.
  invalidateOutlineCache();
  const group = cachedOutlineGroups(entries, axis).find((candidate) => candidate.start === start && candidate.depth === depth);
  if (!group) return true;
  return runOutlinePlan(host, sheetId, axis, planOutlineGroup(entries, group, collapse, axis, host.isHidden));
}

/** Where a line is drawn along its axis, in renderer-container pixels. */
export interface OutlineLineBox {
  readonly start: number;
  readonly size: number;
}

/** One pane on screen along an axis (the frozen band or the scrolling
 *  pane): its line range and, when known, the pixels it covers. A pane
 *  without `from` / `to` starts at its first line's box and ends with its
 *  last one's. */
export interface OutlinePane {
  readonly start: number;
  readonly end: number;
  readonly from?: number;
  readonly to?: number;
}

/** The measurements a layout reads from the grid on screen. */
export interface OutlineMeasure {
  box(axis: OutlineAxis, line: number): OutlineLineBox | null;
  /** The panes on screen per axis (a frozen band and the scrolling pane). */
  visible(axis: OutlineAxis): ReadonlyArray<OutlinePane>;
  isHidden(axis: OutlineAxis, line: number): boolean;
}

/** One bracket as the gutter draws it. `lines` are the bracket's extents
 *  along the axis, one per pane the group shows in (none when collapsed or
 *  scrolled away), `button` the toggle's centre (null when no shown line on
 *  screen carries it: its summary line, or for a collapsed group whose
 *  summary line is not shown, the nearest one). */
export interface OutlineBracket {
  readonly key: string;
  readonly group: OutlineGroup;
  readonly collapsed: boolean;
  readonly lines: ReadonlyArray<{ readonly from: number; readonly to: number }>;
  readonly button: number | null;
}

/** The line a collapsed group's toggle sits on when its summary line is not
 *  shown (hidden by hand, or none at the grid edge): the nearest shown line
 *  on screen after the group, else before it, as Excel draws it. Reads at
 *  most SCAN_LIMIT lines each way. */
function nearestShownLine(
  group: OutlineGroup,
  axis: OutlineAxis,
  windows: ReadonlyArray<{ start: number; end: number }>,
  isHidden: (line: number) => boolean,
): number | null {
  const onScreen = (line: number): boolean => windows.some((window) => line >= window.start && line <= window.end);
  const last = Math.min(AXIS_LINES[axis] - 1, Math.max(...windows.map((window) => window.end)));
  for (let line = group.end + 1, budget = SCAN_LIMIT; line <= last && budget > 0; line += 1, budget -= 1) {
    if (onScreen(line) && !isHidden(line)) return line;
  }
  const first = Math.min(...windows.map((window) => window.start));
  for (let line = group.start - 1, budget = SCAN_LIMIT; line >= first && budget > 0; line -= 1, budget -= 1) {
    if (onScreen(line) && !isHidden(line)) return line;
  }
  return null;
}

/** The brackets of the groups on screen. Every position is read in the pane
 *  that shows its line and clipped to that pane's pixels: a toggle whose line
 *  is scrolled out (behind the frozen band or the header) is not drawn, and
 *  a group straddling the freeze draws one line per pane, so nothing lands on
 *  an unrelated frozen line. A group inside a collapsed one draws nothing
 *  (its lines are folded away). The work per call is bounded by the groups
 *  and lines on screen, not by the size of a group: the groups are cached
 *  and a group's state reads O(1) lines. */
export function layoutOutlineBrackets(
  state: LazyWorkbookState | null,
  sheetId: string | undefined,
  axis: OutlineAxis,
  measure: OutlineMeasure,
): OutlineBracket[] {
  if (!sheetId) return [];
  const entries = entriesFor(state, sheetId, axis);
  const groups = cachedOutlineGroups(entries, axis);
  if (groups.length === 0) return [];
  const windows = measure.visible(axis);
  if (windows.length === 0) return [];
  const boxes = new Map<number, OutlineLineBox | null>();
  const box = (line: number): OutlineLineBox | null => {
    if (!boxes.has(line)) boxes.set(line, measure.box(axis, line));
    return boxes.get(line) ?? null;
  };
  const panes: Array<{ start: number; end: number; from: number; to: number }> = [];
  for (const window of windows) {
    const first = window.from ?? box(window.start)?.start;
    const lastBox = window.to === undefined ? box(window.end) : null;
    const last = window.to ?? (lastBox ? lastBox.start + lastBox.size : undefined);
    if (first !== undefined && last !== undefined && last > first) panes.push({ start: window.start, end: window.end, from: first, to: last });
  }
  if (panes.length === 0) return [];
  const lastOnScreen = Math.max(...panes.map((pane) => pane.end));
  const paneOf = (line: number) => panes.find((pane) => line >= pane.start && line <= pane.end);
  // A shown line's centre, when it is inside the pane that shows the line.
  const centreOnScreen = (line: number): number | null => {
    const pane = paneOf(line);
    const lineBox = pane ? box(line) : null;
    if (!pane || !lineBox || lineBox.size <= 0) return null;
    const centre = lineBox.start + lineBox.size / 2;
    return centre >= pane.from && centre <= pane.to ? centre : null;
  };
  const hidden = (line: number): boolean => measure.isHidden(axis, line);
  const brackets: OutlineBracket[] = [];
  // Enclosing groups of the current one (proper nesting: an ancestor ends at
  // or after its children), with their collapsed state.
  const ancestors: Array<{ end: number; collapsed: boolean }> = [];
  for (const group of groups) {
    if (group.start > lastOnScreen) break;
    const summaryShown = group.summary !== null && !hidden(group.summary);
    const last = group.summary ?? group.end;
    if (!panes.some((pane) => group.start <= pane.end && last >= pane.start)) continue;
    while (ancestors.length > 0 && ancestors.at(-1)!.end < group.start) ancestors.pop();
    const folded = ancestors.some((ancestor) => ancestor.collapsed);
    const collapsed = folded || groupCollapsed(group, entries, hidden, panes);
    ancestors.push({ end: group.end, collapsed });
    if (folded) continue;
    // The toggle sits on the summary line when it is shown, and only where it
    // is on screen; a collapsed group without a shown summary line uses the
    // nearest shown line on screen instead.
    let button = summaryShown ? centreOnScreen(group.summary!) : null;
    if (button === null && !summaryShown && collapsed) {
      const nearest = nearestShownLine(group, axis, panes, hidden);
      button = nearest === null ? null : centreOnScreen(nearest);
    }
    const lines: Array<{ from: number; to: number }> = [];
    if (!collapsed) {
      const end = summaryShown ? group.summary! : group.end;
      for (const pane of panes) {
        const first = Math.max(group.start, pane.start);
        const lastLine = Math.min(end, pane.end);
        if (first > lastLine) continue;
        const startBox = box(first);
        const endBox = box(lastLine);
        if (!startBox || !endBox) continue;
        const from = Math.max(pane.from, startBox.start);
        const reach = summaryShown && lastLine === end ? endBox.start + endBox.size / 2 : endBox.start + endBox.size;
        const to = Math.min(pane.to, reach);
        if (to > from) lines.push({ from, to });
      }
    }
    if (lines.length === 0 && button === null) continue;
    brackets.push({ key: `${axis}:${group.start}:${group.depth}`, group, collapsed, lines, button });
  }
  return brackets;
}
