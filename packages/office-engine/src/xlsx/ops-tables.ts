// XLSX table op parser (create_table / remove_table, tableAdditions slot).
// The typed ops and the fold live in tables.ts; this module holds the wire
// parser only.
import { XlsxOpError, isDict, int, str, a1ToRowColumn, parseStructuralTarget, parseStructuralAttributes, MAX_ROWS, MAX_COLS, type Dict, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";
import { TABLE_OP_KIND, TABLE_REMOVE_OP_KIND, type XlsxTableAddOp } from "./tables.ts";
// ── table ops (create_table / remove_table) ─────────────────────────────────
//
// Wire shape: { op: "create_table", target: { sheet }, range: "A1:C5" or
// {startRow,startColumn,endRow,endColumn}, attributes: { name, columnNames,
// style?, bandedRows? } }. The range includes the header row and must span at
// least one data row (the upstream TableAddition contract). `remove_table`
// carries only { target: { sheet }, attributes: { name } } and cancels an
// earlier create this session.
//
// Gateway limits (honest): the vendored buildTableXml hardcodes
// totalsRowShown="0" with no <totalsRow> and always treats the first row as
// the header, so a total row is not writable and a header-less table is not
// expressible. Both are refused as unsupported rather than silently dropped.

/** OOXML table-name grammar (Excel): 1-255 chars, first char a letter,
 *  underscore or backslash; the rest letters, digits, underscore or period;
 *  never a bare cell reference. */
const TABLE_NAME = /^[A-Za-z_\\][A-Za-z0-9_.]{0,254}$/;
const CELL_REF = /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*$/;
/** Built-in style name (desktop-api workbookTableAddSchema). */
const TABLE_STYLE = /^TableStyle(?:Light|Medium|Dark)[1-9][0-9]?$/;
const MAX_TABLE_COLUMNS = 1_000;
const MAX_COLUMN_NAME_LEN = 255;

function parseTableName(raw: unknown, op: string, field: string): string {
  const name = str(raw, op, field);
  if (!TABLE_NAME.test(name)) {
    throw new XlsxOpError(op, field, "a table name must start with a letter, _ or \\ and use only letters, digits, _ or .");
  }
  if (CELL_REF.test(name)) throw new XlsxOpError(op, field, "a table name cannot be a cell reference");
  return name;
}

function parseColumnNames(raw: unknown, width: number, op: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TABLE_COLUMNS) {
    throw new XlsxOpError(op, "attributes.columnNames", `1-${MAX_TABLE_COLUMNS} column names required`);
  }
  if (raw.length !== width) {
    throw new XlsxOpError(op, "attributes.columnNames", `the range spans ${width} columns but ${raw.length} names were given`);
  }
  const seen = new Set<string>();
  return raw.map((entry) => {
    const name = str(entry, op, "attributes.columnNames");
    const normalized = name.trim().toLowerCase();
    if (normalized.length === 0 || name.length > MAX_COLUMN_NAME_LEN) {
      throw new XlsxOpError(op, "attributes.columnNames", "column names must be non-blank and at most 255 characters");
    }
    if (seen.has(normalized)) throw new XlsxOpError(op, "attributes.columnNames", `duplicate column name ${JSON.stringify(name)}`);
    seen.add(normalized);
    return name;
  });
}

function parseTableArea(raw: unknown, op: string): XlsxTableAddOp["area"] {
  let startRow: number;
  let startColumn: number;
  let endRow: number;
  let endColumn: number;
  if (typeof raw === "string") {
    const parts = raw.split(":");
    if (parts.length !== 2) throw new XlsxOpError(op, "range", "expected A1:C5");
    ({ row: startRow, column: startColumn } = a1ToRowColumn(parts[0] ?? "", op, "range"));
    ({ row: endRow, column: endColumn } = a1ToRowColumn(parts[1] ?? "", op, "range"));
  } else if (isDict(raw)) {
    startRow = int(raw.startRow, op, "range.startRow");
    endRow = int(raw.endRow, op, "range.endRow");
    startColumn = int(raw.startColumn, op, "range.startColumn");
    endColumn = int(raw.endColumn, op, "range.endColumn");
  } else {
    throw new XlsxOpError(op, "range", "A1:C5 string or {startRow,startColumn,endRow,endColumn} required");
  }
  if (startRow < 0 || endRow < 0 || startColumn < 0 || endColumn < 0 ||
      startRow > endRow || startColumn > endColumn || endRow >= MAX_ROWS || endColumn >= MAX_COLS) {
    throw new XlsxOpError(op, "range", "range must be ordered and inside the OOXML grid");
  }
  if (endRow <= startRow) throw new XlsxOpError(op, "range", "a table needs a header row plus at least one data row");
  if (endColumn - startColumn + 1 > MAX_TABLE_COLUMNS) throw new XlsxOpError(op, "range", `at most ${MAX_TABLE_COLUMNS} columns`);
  return { startRow, startColumn, endRow, endColumn };
}

export function parseCreateTable(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  for (const key of Object.keys(a)) {
    if (!["name", "columnNames", "style", "bandedRows", "totalRow", "headerRow"].includes(key)) {
      throw new XlsxOpError(op, "attributes." + key, "unknown table field");
    }
  }
  if (a.totalRow === true) throw new XlsxOpError(op, "attributes.totalRow", "total rows are not supported by the gateway (totalsRowShown is pinned to 0)", true);
  if (a.headerRow === false) throw new XlsxOpError(op, "attributes.headerRow", "a header-less table is not supported by the gateway", true);
  const name = parseTableName(a.name, op, "attributes.name");
  if (item.range === undefined) throw new XlsxOpError(op, "range", "required");
  const area = parseTableArea(item.range, op);
  const columnNames = parseColumnNames(a.columnNames, area.endColumn - area.startColumn + 1, op);
  let style: string | undefined;
  if (a.style !== undefined) {
    style = str(a.style, op, "attributes.style");
    if (!TABLE_STYLE.test(style)) throw new XlsxOpError(op, "attributes.style", "a TableStyle{Light|Medium|Dark}N name required");
  }
  if (a.bandedRows !== undefined && typeof a.bandedRows !== "boolean") {
    throw new XlsxOpError(op, "attributes.bandedRows", "boolean required");
  }
  return [{ kind: TABLE_OP_KIND, sheetName, area, name, columnNames, ...(style === undefined ? {} : { style }), bandedRows: a.bandedRows !== false }];
}

export function parseRemoveTable(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  for (const key of Object.keys(a)) {
    if (key !== "name") throw new XlsxOpError(op, "attributes." + key, "unknown table field");
  }
  const name = parseTableName(a.name, op, "attributes.name");
  return [{ kind: TABLE_REMOVE_OP_KIND, sheetName, name }];
}
