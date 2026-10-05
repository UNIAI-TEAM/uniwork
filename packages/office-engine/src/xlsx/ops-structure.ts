// XLSX structural + merge op parsers (rows/columns, merge/unmerge). Split out
// of ops.ts (FIX-926-B); the shared vocabulary lives in ops-shared.ts.
import { XlsxOpError, isDict, int, a1ToRowColumn, parseRange, parseStructuralTarget, parseStructuralAttributes, axisLimitOf, axisSpan, MAX_ROWS, MAX_COLS, MAX_AXIS_SIZE, MAX_AXIS_SPAN, type Dict, type XlsxMergeArea, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";
// ── structural ops (rows/columns) ──────────────────────────────────────────
//
// Wire shape: { op, target: { sheet }, attributes: { ...fields } }. The fields
// ride the existing raw `attributes` object so the shared Go edit envelope
// (office.EditOp) needs no format-specific schema change; each parser below
// is the strict mirror of its Go validator row.

export function shiftParser(kind: "insert_rows" | "remove_rows" | "insert_cols" | "remove_cols") {
  return (item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] => {
    const sheetName = parseStructuralTarget(item, op, sheets);
    const a = parseStructuralAttributes(item, op);
    const index = int(a.index, op, "attributes.index");
    const count = int(a.count, op, "attributes.count");
    const axisMax = axisLimitOf(kind);
    if (index < 0 || count < 1 || index + count > axisMax) {
      throw new XlsxOpError(op, "attributes", `index/count outside the OOXML grid (${axisMax} lines)`);
    }
    return [{ kind, sheetName, index, count }];
  };
}

export function sizeParser(kind: "set_row_size" | "set_col_size") {
  return (item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] => {
    const sheetName = parseStructuralTarget(item, op, sheets);
    const a = parseStructuralAttributes(item, op);
    const start = int(a.start, op, "attributes.start");
    const end = int(a.end, op, "attributes.end");
    axisSpan(start, end, op, axisLimitOf(kind));
    const size = a.size;
    if (size !== null) {
      if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > MAX_AXIS_SIZE) {
        throw new XlsxOpError(op, "attributes.size", `null or a number in (0, ${MAX_AXIS_SIZE}] required`);
      }
    }
    return [{ kind, sheetName, start, end, size }];
  };
}

export function hiddenParser(kind: "set_rows_hidden" | "set_cols_hidden") {
  return (item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] => {
    const sheetName = parseStructuralTarget(item, op, sheets);
    const a = parseStructuralAttributes(item, op);
    const start = int(a.start, op, "attributes.start");
    const end = int(a.end, op, "attributes.end");
    axisSpan(start, end, op, axisLimitOf(kind));
    if (typeof a.hidden !== "boolean") throw new XlsxOpError(op, "attributes.hidden", "boolean required");
    return [{ kind, sheetName, start, end, hidden: a.hidden }];
  };
}

export function outlineParser(kind: "set_rows_outline" | "set_cols_outline") {
  return (item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] => {
    const sheetName = parseStructuralTarget(item, op, sheets);
    const a = parseStructuralAttributes(item, op);
    const start = int(a.start, op, "attributes.start");
    const end = int(a.end, op, "attributes.end");
    axisSpan(start, end, op, axisLimitOf(kind));
    const level = int(a.level, op, "attributes.level");
    if (level < 0 || level > 7) throw new XlsxOpError(op, "attributes.level", "level must be 0-7");
    if (a.collapsed !== undefined && typeof a.collapsed !== "boolean") {
      throw new XlsxOpError(op, "attributes.collapsed", "boolean required");
    }
    return [{ kind, sheetName, start, end, level, ...(a.collapsed === undefined ? {} : { collapsed: a.collapsed }) }];
  };
}

// ── merge ops (merge cells / unmerge) ──────────────────────────────────────
//
// Wire shape: { op, target: { sheet }, range }. Unlike the row/column kinds the
// rectangle rides the shared envelope's own `range` field (EditOp.Range /
// OfficeEditSDI preserve it), which is the upstream StructuralOp merge shape
// 1:1. "Merge across" is a UI behaviour, not a wire kind: the toolbar emits one
// merge_cells per row of the selection.

/** The merge rectangle: the same two spellings parseRange accepts — an A1
 *  "A1:B2" string or the four 0-based bounds. Ordered, inside the grid, under
 *  the span ceiling and at least two cells (a single-cell merge is not a
 *  merge Excel would write). */
function parseMergeArea(item: Dict, op: string): XlsxMergeArea {
  const raw = item.range;
  let startRow: number;
  let startColumn: number;
  let endRow: number;
  let endColumn: number;
  if (typeof raw === "string") {
    const parts = raw.split(":");
    if (parts.length !== 2) throw new XlsxOpError(op, "range", "expected A1:B2");
    ({ row: startRow, column: startColumn } = a1ToRowColumn(parts[0] ?? "", op, "range"));
    ({ row: endRow, column: endColumn } = a1ToRowColumn(parts[1] ?? "", op, "range"));
  } else if (isDict(raw)) {
    startRow = int(raw.startRow, op, "range.startRow");
    startColumn = int(raw.startColumn, op, "range.startColumn");
    endRow = int(raw.endRow, op, "range.endRow");
    endColumn = int(raw.endColumn, op, "range.endColumn");
    if (startRow < 0 || startRow >= MAX_ROWS || endRow < 0 || endRow >= MAX_ROWS ||
        startColumn < 0 || startColumn >= MAX_COLS || endColumn < 0 || endColumn >= MAX_COLS) {
      throw new XlsxOpError(op, "range", "range is outside the OOXML grid");
    }
  } else {
    throw new XlsxOpError(op, "range", "A1:B5 string or {startRow,startColumn,endRow,endColumn} required");
  }
  if (startRow > endRow || startColumn > endColumn) {
    throw new XlsxOpError(op, "range", "reversed bounds");
  }
  if (endRow - startRow >= MAX_AXIS_SPAN || endColumn - startColumn >= MAX_AXIS_SPAN) {
    throw new XlsxOpError(op, "range", `span over ${MAX_AXIS_SPAN} lines`);
  }
  if (startRow === endRow && startColumn === endColumn) {
    throw new XlsxOpError(op, "range", "a merge needs at least two cells");
  }
  return { startRow, endRow, startColumn, endColumn };
}

export function mergeParser(kind: "merge_cells" | "unmerge_cells") {
  return (item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] => {
    const sheetName = parseStructuralTarget(item, op, sheets);
    return [{ kind, sheetName, range: parseMergeArea(item, op) }];
  };
}

