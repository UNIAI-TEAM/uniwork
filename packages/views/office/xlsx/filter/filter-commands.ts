// Wave B / B4 (UNI-926): filter command core. Pure, renderer-free logic so the
// Data-tab group, the Advanced Filter dialog and the tests share exactly one
// mapping onto the pinned filter commands and their wire shapes.

/** Command ids, all allowlisted in the renderer's command policy:
 *  `smart-toggle-filter` creates the autoFilter over the selection (or removes
 *  it), `clear-filter-criteria` drops every column's criteria, and
 *  `set-filter-range` + `set-filter-criteria` are the two halves the Advanced
 *  Filter dialog drives. */
export const XLSX_FILTER_TOGGLE_COMMAND = "sheet.command.smart-toggle-filter";
export const XLSX_FILTER_CLEAR_COMMAND = "sheet.command.clear-filter-criteria";
export const XLSX_FILTER_SET_RANGE_COMMAND = "sheet.command.set-filter-range";
export const XLSX_FILTER_SET_CRITERIA_COMMAND = "sheet.command.set-filter-criteria";

/** OOXML customFilters carry at most two conditions per column. */
export const XLSX_FILTER_MAX_CONDITIONS = 2;
/** Criteria rows the dialog offers; each column still takes at most two. */
export const XLSX_FILTER_MAX_ROWS = 4;
/** Column choices the dialog reads from the selection's header row; beyond
 *  this the row read is clipped (the command still validates each column
 *  against the live filter range). */
export const XLSX_FILTER_MAX_COLUMNS = 26;

/** The OOXML comparison operators (the pinned Univer CustomFilterOperator
 *  values); an absent operator is equality. */
export type XlsxFilterOperator =
  | "equal"
  | "notEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual";

export const XLSX_FILTER_OPERATORS: readonly XlsxFilterOperator[] = [
  "equal",
  "notEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
];

/** One criteria row of the dialog: an absolute 0-based worksheet column, an
 *  operator and the compared value. */
export interface XlsxFilterCriterionRow {
  column: number;
  operator: XlsxFilterOperator;
  value: string;
}

/** The pinned `set-filter-criteria` params for one column (the Univer
 *  IFilterColumn payload the command carries as `criteria`). */
export interface XlsxFilterCriteriaOperation {
  col: number;
  criteria: {
    colId: number;
    customFilters: {
      and?: 1;
      customFilters: { val: string; operator?: Exclude<XlsxFilterOperator, "equal"> }[];
    };
  };
}

/** Rows grouped per column and mapped to one command call per column. OOXML
 *  customFilters carry one or two conditions joined by AND/OR; a value is
 *  required, and at most two rows may target the same column. Throws with a
 *  caller-facing reason instead of emitting a half-valid criteria payload. */
export function filterCriteriaOperations(
  rows: readonly XlsxFilterCriterionRow[],
  join: "and" | "or",
): XlsxFilterCriteriaOperation[] {
  const byColumn = new Map<number, XlsxFilterCriterionRow[]>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.column) || row.column < 0) throw new Error("filter_column_invalid");
    if (row.value === "") throw new Error("filter_value_required");
    const list = byColumn.get(row.column) ?? [];
    list.push(row);
    byColumn.set(row.column, list);
  }
  return [...byColumn].map(([col, conditions]) => {
    if (conditions.length > XLSX_FILTER_MAX_CONDITIONS) throw new Error("filter_too_many_conditions");
    return {
      col,
      criteria: {
        colId: col,
        customFilters: {
          ...(join === "and" && conditions.length === 2 ? { and: 1 as const } : {}),
          customFilters: conditions.map((condition) =>
            condition.operator === "equal"
              ? { val: condition.value }
              : { val: condition.value, operator: condition.operator },
          ),
        },
      },
    };
  });
}

/** The filter rectangle a selection spans. Both corners are 0-based positions
 *  already validated by the editor's address parsing. */
export function selectionFilterArea(
  start: { row: number; column: number },
  end: { row: number; column: number },
): { startRow: number; endRow: number; startColumn: number; endColumn: number } {
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}
