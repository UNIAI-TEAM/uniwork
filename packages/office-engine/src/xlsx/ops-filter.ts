// XLSX filter op parsers (auto filter / advanced filter). Split out of ops.ts
// (FIX-926-B); the shared vocabulary lives in ops-shared.ts.
import { XlsxOpError, isDict, int, parseStructuralTarget, parseStructuralAttributes, MAX_ROWS, MAX_COLS, MAX_AXIS_SPAN, type Dict, type XlsxMergeArea, type XlsxFilterColumnState, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";
// ── filter ops (auto filter / advanced filter) ─────────────────────────────
//
// Wire shape: { op, target: { sheet }, attributes: { ... } }. set_filter
// carries the whole declarative snapshot — the filter rectangle, its
// per-column criteria and the rows the filter hides; clear_filter carries the
// visibility range so the gateway can unhide the rows the removed filter was
// hiding. Bounds mirror the vendored wire schema (desktop-api.ts
// workbookFilterStateSchema) and the upstream FilterColumnState.

const MAX_FILTER_COLUMNS = 1_000;
const MAX_FILTER_VALUES = 10_000;
const MAX_FILTER_VALUE_LEN = 32_767;
const MAX_FILTER_HIDDEN_ROWS = 100_000;
/** The OOXML customFilter operators the upstream serializer accepts. */
const FILTER_OPERATORS = new Set([
  "equal",
  "notEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
]);

/** A filter rectangle: the four 0-based bounds of an ordered, in-grid area
 *  under the span ceiling. Unlike a merge it may be a single cell only for
 *  `visibilityRange`; the filter's own range needs a header and a data row. */
function parseFilterArea(raw: unknown, op: string, field: string): XlsxMergeArea {
  if (!isDict(raw)) throw new XlsxOpError(op, field, "object required");
  const startRow = int(raw.startRow, op, `${field}.startRow`);
  const endRow = int(raw.endRow, op, `${field}.endRow`);
  const startColumn = int(raw.startColumn, op, `${field}.startColumn`);
  const endColumn = int(raw.endColumn, op, `${field}.endColumn`);
  if (startRow < 0 || endRow < 0 || startColumn < 0 || endColumn < 0 ||
      startRow > endRow || startColumn > endColumn ||
      endRow >= MAX_ROWS || endColumn >= MAX_COLS) {
    throw new XlsxOpError(op, field, "range must be ordered and inside the OOXML grid");
  }
  if (endRow - startRow >= MAX_AXIS_SPAN || endColumn - startColumn >= MAX_AXIS_SPAN) {
    throw new XlsxOpError(op, field, `span over ${MAX_AXIS_SPAN} lines`);
  }
  return { startRow, endRow, startColumn, endColumn };
}

/** One filter column: colId inside the filter range, exactly one criteria
 *  family, values/operators bounded. */
function parseFilterColumn(raw: unknown, op: string, width: number): XlsxFilterColumnState {
  if (!isDict(raw)) throw new XlsxOpError(op, "attributes.filter.columns", "column objects required");
  const colId = int(raw.colId, op, "attributes.filter.columns.colId");
  if (colId < 0 || colId >= width || colId >= MAX_COLS) {
    throw new XlsxOpError(op, "attributes.filter.columns.colId", "colId outside the filter range");
  }
  let values: string[] | undefined;
  if (raw.values !== undefined) {
    if (!Array.isArray(raw.values) || raw.values.length > MAX_FILTER_VALUES) {
      throw new XlsxOpError(op, "attributes.filter.columns.values", `at most ${MAX_FILTER_VALUES} values`);
    }
    values = raw.values.map((value) => {
      if (typeof value !== "string" || value.length > MAX_FILTER_VALUE_LEN) {
        throw new XlsxOpError(op, "attributes.filter.columns.values", "value strings are bounded");
      }
      return value;
    });
  }
  let blank: boolean | undefined;
  if (raw.blank !== undefined) {
    if (typeof raw.blank !== "boolean") throw new XlsxOpError(op, "attributes.filter.columns.blank", "boolean required");
    blank = raw.blank;
  }
  let customs: XlsxFilterColumnState["customs"];
  if (raw.customs !== undefined) {
    if (!isDict(raw.customs) || !Array.isArray(raw.customs.filters) ||
        raw.customs.filters.length < 1 || raw.customs.filters.length > 2) {
      throw new XlsxOpError(op, "attributes.filter.columns.customs", "one or two custom filters required");
    }
    if (raw.customs.and !== undefined && typeof raw.customs.and !== "boolean") {
      throw new XlsxOpError(op, "attributes.filter.columns.customs.and", "boolean required");
    }
    const filters = raw.customs.filters.map((condition) => {
      if (!isDict(condition)) throw new XlsxOpError(op, "attributes.filter.columns.customs.filters", "condition objects required");
      const { val } = condition;
      if (typeof val === "string") {
        if (val.length > MAX_FILTER_VALUE_LEN) throw new XlsxOpError(op, "attributes.filter.columns.customs.filters.val", "value too long");
      } else if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new XlsxOpError(op, "attributes.filter.columns.customs.filters.val", "string or finite number required");
      }
      if (condition.operator !== undefined && (typeof condition.operator !== "string" || !FILTER_OPERATORS.has(condition.operator))) {
        throw new XlsxOpError(op, "attributes.filter.columns.customs.filters.operator", "unknown filter operator");
      }
      return { val, ...(condition.operator === undefined ? {} : { operator: condition.operator }) };
    });
    customs = { ...(raw.customs.and === undefined ? {} : { and: raw.customs.and }), filters };
  }
  if (values === undefined && blank === undefined && customs === undefined) {
    throw new XlsxOpError(op, "attributes.filter.columns", "a filter column needs values, a blank flag, or custom criteria");
  }
  return { colId, values, blank, customs };
}

function parseFilterHiddenRows(raw: unknown, op: string): number[] {
  if (!Array.isArray(raw) || raw.length > MAX_FILTER_HIDDEN_ROWS) {
    throw new XlsxOpError(op, "attributes.hiddenRows", `at most ${MAX_FILTER_HIDDEN_ROWS} hidden rows`);
  }
  return raw.map((row) => {
    const index = int(row, op, "attributes.hiddenRows");
    if (index < 0 || index >= MAX_ROWS) throw new XlsxOpError(op, "attributes.hiddenRows", "row outside the OOXML grid");
    return index;
  });
}

export function parseSetFilter(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  if (!isDict(a.filter)) throw new XlsxOpError(op, "attributes.filter", "object required");
  const range = parseFilterArea(a.filter.range, op, "attributes.filter.range");
  if (range.endRow === range.startRow) {
    throw new XlsxOpError(op, "attributes.filter.range", "a filter range needs a header row and a data row");
  }
  if (!Array.isArray(a.filter.columns) || a.filter.columns.length > MAX_FILTER_COLUMNS) {
    throw new XlsxOpError(op, "attributes.filter.columns", `at most ${MAX_FILTER_COLUMNS} columns`);
  }
  const width = range.endColumn - range.startColumn + 1;
  const columns = a.filter.columns.map((column) => parseFilterColumn(column, op, width));
  const seen = new Set<number>();
  for (const column of columns) {
    if (seen.has(column.colId)) throw new XlsxOpError(op, "attributes.filter.columns", "duplicate colId");
    seen.add(column.colId);
  }
  return [
    {
      kind: "set_filter",
      sheetName,
      filter: { range, columns },
      hiddenRows: parseFilterHiddenRows(a.hiddenRows, op),
      visibilityRange: parseFilterArea(a.visibilityRange, op, "attributes.visibilityRange"),
    },
  ];
}

export function parseClearFilter(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  return [{ kind: "clear_filter", sheetName, visibilityRange: parseFilterArea(a.visibilityRange, op, "attributes.visibilityRange") }];
}

