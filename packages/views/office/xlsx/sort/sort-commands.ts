// Wave A / A7 (UNI-926): sort command core. Pure, renderer-free logic so the
// Data-tab group, the Custom Sort dialog and the tests share exactly one
// mapping onto the pinned Univer sort commands and their wire shapes.
//
// Route: the pinned `sheet.command.sort-range` command (dispatched by the
// `sheets-sort` preset the shim controller already installs) sorts the
// selection in place by reordering whole rows. Every reordered cell is
// journalled through the renderer's existing cell-edit path, so a sort saves
// exactly like manual typing - there is no second save path and no byte write.

/** The pinned sort command: `{ range, orderRules, hasTitle }` plus the sheet
 *  scope the shim controller fills in. Allowlisted in the renderer's command
 *  policy. */
export const XLSX_SORT_COMMAND = "sheet.command.sort-range";

/** Ascending / descending are the pinned `SortType` values. */
export type XlsxSortDirection = "asc" | "desc";

export const XLSX_SORT_DIRECTIONS: readonly XlsxSortDirection[] = ["asc", "desc"];

/** The engine's op budget per save job (server maxOfficeEditOps). A sort that
 *  would rewrite more cells than this is refused before the command runs:
 *  sorting is all-or-nothing, and a partially journalled sort would save a
 *  half-sorted sheet. */
export const XLSX_SORT_MAX_OPS = 10_000;

/** One 0-based inclusive rectangle, the same shape the renderer commands and
 *  the journal use. */
export interface XlsxSortRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

/** The pinned `IOrderRule` payload: one sort key. A single rule keeps the UI
 *  single-level; multi-level sort is out of scope for this task. */
export interface XlsxSortOrderRule {
  type: XlsxSortDirection;
  colIndex: number;
}

/** The pinned `sheet.command.sort-range` params the shim controller forwards. */
export interface XlsxSortCommandParams {
  unitId?: string;
  subUnitId?: string;
  range: XlsxSortRange;
  orderRules: XlsxSortOrderRule[];
  hasTitle: boolean;
}

/** The cells a sort rewrites: every cell of the sorted range (rows x columns).
 *  The engine op budget counts the journaled cell edits, not the rows. */
export function sortAffectedCellCount(range: XlsxSortRange): number {
  const rows = range.endRow - range.startRow + 1;
  const columns = range.endColumn - range.startColumn + 1;
  if (!Number.isFinite(rows) || !Number.isFinite(columns) || rows <= 0 || columns <= 0) return 0;
  return rows * columns;
}

/** Refuse a sort that would exceed the engine's per-job op budget. Returns the
 *  affected cell count when the sort is allowed, or null when it must be
 *  refused (never partially sorted). The UI surfaces the vi+en message; the
 *  command is not dispatched at all. */
export function sortWithinOpLimit(range: XlsxSortRange, limit = XLSX_SORT_MAX_OPS): number | null {
  const cells = sortAffectedCellCount(range);
  if (cells <= 0 || cells > limit) return null;
  return cells;
}

/** A sort must span at least two rows and one column to be meaningful. */
export function sortRangeIsSortable(range: XlsxSortRange): boolean {
  return (
    Number.isInteger(range.startRow) &&
    Number.isInteger(range.endRow) &&
    Number.isInteger(range.startColumn) &&
    Number.isInteger(range.endColumn) &&
    range.startRow >= 0 &&
    range.startColumn >= 0 &&
    range.startRow < range.endRow &&
    range.startColumn <= range.endColumn
  );
}

/** Build the pinned `sheet.command.sort-range` params for one key column inside
 *  the selection. `keyColumn` is an absolute 0-based worksheet column that must
 *  lie inside the range; `hasHeaderRow` excludes the first row from the sort
 *  and keeps it in place. Throws with a caller-facing reason instead of
 *  emitting a malformed command. */
export function sortCommandParams(
  range: XlsxSortRange,
  keyColumn: number,
  direction: XlsxSortDirection,
  hasHeaderRow: boolean,
): XlsxSortCommandParams {
  if (!sortRangeIsSortable(range)) throw new Error("sort_range_unsortable");
  if (!Number.isInteger(keyColumn) || keyColumn < range.startColumn || keyColumn > range.endColumn) {
    throw new Error("sort_key_outside_range");
  }
  return {
    range: { ...range },
    orderRules: [{ type: direction, colIndex: keyColumn }],
    hasTitle: hasHeaderRow,
  };
}

/** The sort rectangle a selection spans. Both corners are 0-based positions
 *  already validated by the editor's address parsing. */
export function selectionSortRange(
  start: { row: number; column: number },
  end: { row: number; column: number },
): XlsxSortRange {
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}
