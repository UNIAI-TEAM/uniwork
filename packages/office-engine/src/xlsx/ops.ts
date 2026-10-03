// Envelope edits[] → typed XLSX ops. Each item is {op, target, text, style,
// attributes} per the contract's EDIT_FIELDS; the op vocabulary is this lane's
// (set_cell / clear_cell / set_cells). A malformed item is a typed XlsxOpError,
// never a silent drop — the caller's ops either all parse or the job fails
// before a byte is touched.
import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import type { XlsxCellScalar, XlsxCellState, XlsxGatewayArguments } from "./engine.ts";

export class XlsxOpError extends Error {
  readonly opName: string;
  readonly field: string;
  /** The op itself is outside the bound vocabulary (not a malformed argument). */
  readonly unsupported: boolean;
  constructor(opName: string, field: string, message: string, unsupported = false) {
    super(`${opName}.${field}: ${message}`);
    this.name = "XlsxOpError";
    this.opName = opName;
    this.field = field;
    this.unsupported = unsupported;
  }
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => v !== null && typeof v === "object" && !Array.isArray(v);

/** Cheap text bound — the envelope caps total bytes, but one cell's text still
 *  gets its own ceiling so a malformed op fails before any engine call. */
const MAX_TEXT_LEN = 1 << 20;

/** OOXML grid bounds (ECMA-376): rows 1..1048576, columns A..XFD. */
const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;
/** Row height (points) / column width (character units) ceiling, mirroring
 *  the upstream structural wire schema (desktop-api.ts structuralOps). */
const MAX_AXIS_SIZE = 500;
/** Span ceiling a size/hidden/outline op may address (same wire schema). */
const MAX_AXIS_SPAN = 100_000;
const A1 = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/;

export interface XlsxCellTarget {
  readonly sheetName: string;
  /** 0-based row/column, matching every engine wire surface. */
  readonly row: number;
  readonly column: number;
  /** A1 spelling, for messages and the model's cell map. */
  readonly address: string;
}

/** A 0-based inclusive rectangle — the merge range and the shape the upstream
 *  StructuralOp merge branch carries (xlsx-structure.ts CellArea). */
export interface XlsxMergeArea {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

/** One row/column structural op (envelope `structuralOps` slot). Positions
 *  are 0-based; sizes are points for rows and character width for columns,
 *  null = the sheet default. Every op maps 1:1 to the upstream StructuralOp
 *  (xlsx-gateway/src/gateway/xlsx-structure.ts) via toUpstreamStructuralOps. */
export type XlsxStructuralOp =
  | {
      readonly kind: "insert_rows" | "remove_rows" | "insert_cols" | "remove_cols";
      readonly sheetName: string;
      readonly index: number;
      readonly count: number;
    }
  | {
      readonly kind: "set_row_size" | "set_col_size";
      readonly sheetName: string;
      readonly start: number;
      readonly end: number;
      readonly size: number | null;
    }
  | {
      readonly kind: "set_rows_hidden" | "set_cols_hidden";
      readonly sheetName: string;
      readonly start: number;
      readonly end: number;
      readonly hidden: boolean;
    }
  | {
      readonly kind: "set_rows_outline" | "set_cols_outline";
      readonly sheetName: string;
      readonly start: number;
      readonly end: number;
      readonly level: number;
      /** Omitted leaves the file's collapsed flag untouched (upstream). */
      readonly collapsed?: boolean | undefined;
    }
  | {
      /** merge_cells/unmerge_cells — the rectangle rides the envelope's own
       *  `range` field (EditOp.Range preserves it). Merges never move cells,
       *  so the journal records them in emission order and the session model
       *  appends without shifting (a later row/column op shifts them in the
       *  gateway, which is the same result the renderer shows). */
      readonly kind: "merge_cells" | "unmerge_cells";
      readonly sheetName: string;
      readonly range: XlsxMergeArea;
    };

/** The bound structural wire vocabulary; the model's shift rule keys on it. */
const STRUCTURAL_OP_KIND_LIST = [
  "insert_rows",
  "remove_rows",
  "insert_cols",
  "remove_cols",
  "set_row_size",
  "set_col_size",
  "set_rows_hidden",
  "set_cols_hidden",
  "set_rows_outline",
  "set_cols_outline",
  "merge_cells",
  "unmerge_cells",
] as const;

const STRUCTURAL_KIND_SET: ReadonlySet<string> = new Set(STRUCTURAL_OP_KIND_LIST);

export function isXlsxStructuralOp(op: XlsxEditOp): op is XlsxStructuralOp {
  return STRUCTURAL_KIND_SET.has(op.kind);
}

/** The upstream StructuralOp payload the vendored gateway consumes
 *  (kebab-case kinds; xlsx-structure.ts). */
export type XlsxUpstreamStructuralOp =
  | { readonly kind: "insert-rows" | "remove-rows" | "insert-cols" | "remove-cols"; readonly index: number; readonly count: number }
  | { readonly kind: "merge-cells" | "unmerge-cells"; readonly range: XlsxMergeArea }
  | { readonly kind: "set-row-size" | "set-col-size"; readonly start: number; readonly end: number; readonly size: number | null }
  | { readonly kind: "set-rows-hidden" | "set-cols-hidden"; readonly start: number; readonly end: number; readonly hidden: boolean }
  | {
      readonly kind: "set-rows-outline" | "set-cols-outline";
      readonly start: number;
      readonly end: number;
      readonly level: number;
      readonly collapsed?: boolean | undefined;
    };

/** The gateway's SheetStructuralOps: one sheet's ops in replay order. */
export interface XlsxSheetStructuralOps {
  readonly sheetName: string;
  readonly ops: readonly XlsxUpstreamStructuralOp[];
}

function toUpstreamStructuralOp(op: XlsxStructuralOp): XlsxUpstreamStructuralOp {
  const kind = op.kind.replaceAll("_", "-") as XlsxUpstreamStructuralOp["kind"];
  switch (op.kind) {
    case "insert_rows":
    case "remove_rows":
    case "insert_cols":
    case "remove_cols":
      return { kind, index: op.index, count: op.count } as XlsxUpstreamStructuralOp;
    case "set_row_size":
    case "set_col_size":
      return { kind, start: op.start, end: op.end, size: op.size } as XlsxUpstreamStructuralOp;
    case "set_rows_hidden":
    case "set_cols_hidden":
      return { kind, start: op.start, end: op.end, hidden: op.hidden } as XlsxUpstreamStructuralOp;
    case "set_rows_outline":
    case "set_cols_outline":
      return {
        kind,
        start: op.start,
        end: op.end,
        level: op.level,
        ...(op.collapsed === undefined ? {} : { collapsed: op.collapsed }),
      } as XlsxUpstreamStructuralOp;
    case "merge_cells":
    case "unmerge_cells":
      return { kind, range: { ...op.range } } as XlsxUpstreamStructuralOp;
  }
}

/** Group parsed ops per sheet (first-touch sheet order, per-sheet journal
 *  order) for the gateway's structuralOps argument. Cell ops are ignored. */
export function groupXlsxStructuralOps(ops: readonly XlsxEditOp[]): XlsxSheetStructuralOps[] {
  const bySheet = new Map<string, XlsxUpstreamStructuralOp[]>();
  for (const op of ops) {
    if (!isXlsxStructuralOp(op)) continue;
    const list = bySheet.get(op.sheetName) ?? [];
    list.push(toUpstreamStructuralOp(op));
    bySheet.set(op.sheetName, list);
  }
  return [...bySheet].map(([sheetName, sheetOps]) => ({ sheetName, ops: sheetOps }));
}

export type XlsxEditOp =
  | {
      readonly kind: "set_cell";
      readonly target: XlsxCellTarget;
      /** The stored-cell replacement; ignored when writeValue is false. */
      readonly cell: XlsxCellState;
      /** false = style-only edit (upstream CellEdit.writeValue). */
      readonly writeValue: boolean;
      readonly style?: Record<string, unknown> | undefined;
      readonly styleReset?: boolean | undefined;
      /** Sidecar wire input text for the same edit (recalc.rs `input`). */
      readonly recalcInput: string;
    }
  | { readonly kind: "clear_cell"; readonly target: XlsxCellTarget; readonly recalcInput: "" }
  | XlsxStructuralOp;

/** The gateway argument slot an op kind feeds. `cellEdits` is
 *  applyCellEditsToXlsx's `edits` argument (the cell path the session model
 *  folds); every other name is one of the XlsxGatewayArguments slots
 *  vendor.ts maps positionally. Typing the tag as keyof
 *  XlsxGatewayArguments keeps a registry entry from drifting off the
 *  argument interface. */
export type XlsxOpKindSlot = "cellEdits" | keyof XlsxGatewayArguments;

/** One bound wire op kind. A later op kind lands as one entry in
 *  XLSX_OP_KINDS (plus its typed op in XlsxEditOp) — parseXlsxOps never grows
 *  another case. `parse` returns ops because a kind may expand: set_cells
 *  folds one range item into one op per cell. */
export interface XlsxOpKind {
  readonly wireName: string;
  readonly slot: XlsxOpKindSlot;
  parse(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[];
}

/** Sheet-name resolver over the opened workbook: names are the wire identity;
 *  `sheet-N` gateway ids resolve through sheetNamesById when a caller uses
 *  them. */
export interface XlsxSheetResolver {
  sheetNames(): readonly string[];
  nameForId(id: string): string | undefined;
}

function int(v: unknown, op: string, f: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new XlsxOpError(op, f, "integer required");
  return v;
}

function str(v: unknown, op: string, f: string): string {
  if (typeof v !== "string") throw new XlsxOpError(op, f, "string required");
  return v;
}

export function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function a1ToRowColumn(address: string, op: string, f: string): { row: number; column: number } {
  const m = A1.exec(address);
  if (!m) throw new XlsxOpError(op, f, "cell must be an A1 address like B5");
  const row = Number(m[2]) - 1;
  const column = columnLettersToIndex(m[1] ?? "A");
  if (row >= MAX_ROWS || column >= MAX_COLS) {
    throw new XlsxOpError(op, f, "cell is outside the OOXML grid");
  }
  return { row, column };
}

/** The "what the user typed" text the sidecar's recalc edit wants: explicit
 *  formula text wins; a typed scalar serializes the way Excel typing would
 *  (true→TRUE, 42→"42"); null/"" clears. */
export function recalcInputFor(cell: XlsxCellState): string {
  if (cell.formula !== undefined) return cell.formula;
  const v = cell.value;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function parseSheet(target: Dict, op: string, sheets: XlsxSheetResolver): string {
  if (target.sheet !== undefined) {
    const name = str(target.sheet, op, "target.sheet");
    if (!sheets.sheetNames().includes(name)) {
      throw new XlsxOpError(op, "target.sheet", "unknown sheet " + JSON.stringify(name));
    }
    return name;
  }
  if (target.sheetId !== undefined) {
    const id = str(target.sheetId, op, "target.sheetId");
    const name = sheets.nameForId(id);
    if (name === undefined) throw new XlsxOpError(op, "target.sheetId", "unknown sheet " + JSON.stringify(id));
    return name;
  }
  throw new XlsxOpError(op, "target.sheet", "required (sheet name or sheetId)");
}

function parseTarget(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxCellTarget {
  if (!isDict(item.target)) throw new XlsxOpError(op, "target", "object required");
  const sheetName = parseSheet(item.target, op, sheets);
  let row: number;
  let column: number;
  if (item.target.cell !== undefined) {
    ({ row, column } = a1ToRowColumn(str(item.target.cell, op, "target.cell"), op, "target.cell"));
  } else {
    row = int(item.target.row, op, "target.row");
    column = int(item.target.column, op, "target.column");
    if (row < 0 || row >= MAX_ROWS || column < 0 || column >= MAX_COLS) {
      throw new XlsxOpError(op, "target", "row/column outside the OOXML grid");
    }
  }
  return { sheetName, row, column, address: toA1(row, column) };
}

function parseRange(item: Dict, op: string, sheets: XlsxSheetResolver): { sheetName: string; rows: number[]; columns: number[] } {
  if (!isDict(item.target)) throw new XlsxOpError(op, "target", "object required");
  const sheetName = parseSheet(item.target, op, sheets);
  const range = item.range;
  let start: { row: number; column: number };
  let end: { row: number; column: number };
  if (typeof range === "string") {
    const [a, b] = range.split(":");
    if (b === undefined) throw new XlsxOpError(op, "range", "expected A1:B5");
    start = a1ToRowColumn(a ?? "", op, "range");
    end = a1ToRowColumn(b, op, "range");
  } else if (isDict(range)) {
    start = { row: int(range.startRow, op, "range.startRow"), column: int(range.startColumn, op, "range.startColumn") };
    end = { row: int(range.endRow, op, "range.endRow"), column: int(range.endColumn, op, "range.endColumn") };
  } else {
    throw new XlsxOpError(op, "range", "A1:B5 string or {startRow,startColumn,endRow,endColumn} required");
  }
  if (start.row > end.row || start.column > end.column) {
    throw new XlsxOpError(op, "range", "reversed bounds");
  }
  const cells = (end.row - start.row + 1) * (end.column - start.column + 1);
  if (cells > ENGINE_LIMITS.max_edit_ops) {
    throw new XlsxOpError(op, "range", `range expands to ${cells} cells, over the ${ENGINE_LIMITS.max_edit_ops} op bound`);
  }
  const rows = Array.from({ length: end.row - start.row + 1 }, (_, i) => start.row + i);
  const columns = Array.from({ length: end.column - start.column + 1 }, (_, i) => start.column + i);
  return { sheetName, rows, columns };
}

function columnName(column: number): string {
  let n = column + 1;
  let name = "";
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function toA1(row: number, column: number): string {
  return columnName(column) + String(row + 1);
}

const isScalar = (v: unknown): v is XlsxCellScalar =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function parseCellValue(item: Dict, op: string): { cell: XlsxCellState; writeValue: boolean } {
  const a = isDict(item.attributes) ? item.attributes : {};
  if (a.formula !== undefined) {
    const formula = str(a.formula, op, "attributes.formula");
    if (formula.length === 0 || !formula.startsWith("=")) {
      throw new XlsxOpError(op, "attributes.formula", "formula text must start with =");
    }
    if (formula.length > MAX_TEXT_LEN) {
      throw new XlsxOpError(op, "attributes.formula", "formula exceeds the text bound");
    }
    return { cell: { value: null, formula }, writeValue: true };
  }
  if (a.value !== undefined) {
    if (!isScalar(a.value)) throw new XlsxOpError(op, "attributes.value", "string|number|boolean|null required");
    return { cell: { value: a.value }, writeValue: true };
  }
  if (item.text !== undefined) {
    const text = str(item.text, op, "text");
    if (text.length > MAX_TEXT_LEN) throw new XlsxOpError(op, "text", "text exceeds the bound");
    // Typed-as-typed: "=..." is a formula, anything else is literal text. A
    // caller wanting a numeric or a string-spelled-number goes through
    // attributes.value.
    if (text.startsWith("=")) return { cell: { value: null, formula: text }, writeValue: true };
    return { cell: { value: text }, writeValue: true };
  }
  return { cell: { value: null }, writeValue: false };
}

function parseStyle(item: Dict, op: string): { style?: Record<string, unknown>; styleReset?: boolean } {
  const a = isDict(item.attributes) ? item.attributes : {};
  const style = item.style ?? a.style;
  if (style === undefined && a.styleReset === undefined) return {};
  if (style !== undefined && !isDict(style)) throw new XlsxOpError(op, "style", "object required");
  const styleReset = a.styleReset === undefined ? undefined : a.styleReset === true;
  if (a.styleReset !== undefined && typeof a.styleReset !== "boolean") {
    throw new XlsxOpError(op, "attributes.styleReset", "boolean required");
  }
  return { ...(isDict(style) ? { style } : {}), ...(styleReset !== undefined ? { styleReset } : {}) };
}

function parseSetCell(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const target = parseTarget(item, op, sheets);
  const { cell, writeValue } = parseCellValue(item, op);
  const { style, styleReset } = parseStyle(item, op);
  if (!writeValue && style === undefined && styleReset === undefined) {
    throw new XlsxOpError(op, "text", "set_cell needs text, attributes.value/formula, or a style");
  }
  return [
    {
      kind: "set_cell",
      target,
      cell,
      writeValue,
      style,
      styleReset,
      // Style-only edits are invisible to the recalc model.
      recalcInput: writeValue ? recalcInputFor(cell) : "",
    },
  ];
}

function parseClearCell(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  return [{ kind: "clear_cell", target: parseTarget(item, op, sheets), recalcInput: "" }];
}

function parseSetCells(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const { sheetName, rows, columns } = parseRange(item, op, sheets);
  const { cell, writeValue } = parseCellValue(item, op);
  if (!writeValue) throw new XlsxOpError(op, "text", "set_cells needs text or attributes.value/formula");
  const { style, styleReset } = parseStyle(item, op);
  const ops: XlsxEditOp[] = [];
  for (const row of rows) {
    for (const column of columns) {
      ops.push({
        kind: "set_cell",
        target: { sheetName, row, column, address: toA1(row, column) },
        cell,
        writeValue: true,
        style,
        styleReset,
        recalcInput: recalcInputFor(cell),
      });
    }
  }
  return ops;
}

// ── structural ops (rows/columns) ──────────────────────────────────────────
//
// Wire shape: { op, target: { sheet }, attributes: { ...fields } }. The fields
// ride the existing raw `attributes` object so the shared Go edit envelope
// (office.EditOp) needs no format-specific schema change; each parser below
// is the strict mirror of its Go validator row.

function parseStructuralTarget(item: Dict, op: string, sheets: XlsxSheetResolver): string {
  if (!isDict(item.target)) throw new XlsxOpError(op, "target", "object required");
  return parseSheet(item.target, op, sheets);
}

function parseStructuralAttributes(item: Dict, op: string): Dict {
  if (!isDict(item.attributes)) throw new XlsxOpError(op, "attributes", "object required");
  return item.attributes;
}

/** Rows kinds bound to MAX_ROWS; every other structural kind is a column
 *  kind bound to MAX_COLS. */
function axisLimitOf(op: string): number {
  return op.includes("row") ? MAX_ROWS : MAX_COLS;
}

function axisSpan(start: number, end: number, op: string, axisMax: number): void {
  if (start < 0 || end < 0 || end < start) throw new XlsxOpError(op, "attributes", "reversed or negative span");
  if (end >= axisMax) throw new XlsxOpError(op, "attributes", "span is outside the OOXML grid");
  if (end - start >= MAX_AXIS_SPAN) {
    throw new XlsxOpError(op, "attributes", `span over ${MAX_AXIS_SPAN} lines`);
  }
}

function shiftParser(kind: "insert_rows" | "remove_rows" | "insert_cols" | "remove_cols") {
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

function sizeParser(kind: "set_row_size" | "set_col_size") {
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

function hiddenParser(kind: "set_rows_hidden" | "set_cols_hidden") {
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

function outlineParser(kind: "set_rows_outline" | "set_cols_outline") {
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

function mergeParser(kind: "merge_cells" | "unmerge_cells") {
  return (item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] => {
    const sheetName = parseStructuralTarget(item, op, sheets);
    return [{ kind, sheetName, range: parseMergeArea(item, op) }];
  };
}

/** The bound wire vocabulary, in the order the unknown-op message lists it.
 *  A later op kind appends its entry here (with its typed op in XlsxEditOp
 *  and its slot named) — parseXlsxOps itself does not change. */
export const XLSX_OP_KINDS: readonly XlsxOpKind[] = [
  { wireName: "set_cell", slot: "cellEdits", parse: parseSetCell },
  { wireName: "clear_cell", slot: "cellEdits", parse: parseClearCell },
  { wireName: "set_cells", slot: "cellEdits", parse: parseSetCells },
  { wireName: "insert_rows", slot: "structuralOps", parse: shiftParser("insert_rows") },
  { wireName: "remove_rows", slot: "structuralOps", parse: shiftParser("remove_rows") },
  { wireName: "insert_cols", slot: "structuralOps", parse: shiftParser("insert_cols") },
  { wireName: "remove_cols", slot: "structuralOps", parse: shiftParser("remove_cols") },
  { wireName: "set_row_size", slot: "structuralOps", parse: sizeParser("set_row_size") },
  { wireName: "set_col_size", slot: "structuralOps", parse: sizeParser("set_col_size") },
  { wireName: "set_rows_hidden", slot: "structuralOps", parse: hiddenParser("set_rows_hidden") },
  { wireName: "set_cols_hidden", slot: "structuralOps", parse: hiddenParser("set_cols_hidden") },
  { wireName: "set_rows_outline", slot: "structuralOps", parse: outlineParser("set_rows_outline") },
  { wireName: "set_cols_outline", slot: "structuralOps", parse: outlineParser("set_cols_outline") },
  { wireName: "merge_cells", slot: "structuralOps", parse: mergeParser("merge_cells") },
  { wireName: "unmerge_cells", slot: "structuralOps", parse: mergeParser("unmerge_cells") },
];

const OP_KIND_BY_NAME: ReadonlyMap<string, XlsxOpKind> = new Map(XLSX_OP_KINDS.map((kind) => [kind.wireName, kind]));

/**
 * Fold a validated envelope edits array into typed ops through the op-kind
 * registry. Unknown op names are a typed error (unsupported): the caller
 * learns the vocabulary is narrower than upstream's full sheet-op set, not
 * that its op vanished.
 */
export function parseXlsxOps(edits: unknown[], sheets: XlsxSheetResolver): XlsxEditOp[] {
  if (edits.length > ENGINE_LIMITS.max_edit_ops) {
    throw new XlsxOpError("<edits>", "", `at most ${ENGINE_LIMITS.max_edit_ops} ops per job`);
  }
  const ops: XlsxEditOp[] = [];
  for (const item of edits) {
    if (!isDict(item)) throw new XlsxOpError("<item>", "", "object required");
    const op = str(item.op, "<item>", "op");
    const kind = OP_KIND_BY_NAME.get(op);
    if (!kind) {
      const bound = XLSX_OP_KINDS.map((entry) => entry.wireName).join(", ");
      throw new XlsxOpError(op, "", `unknown op for xlsx (bound: ${bound})`, true);
    }
    for (const parsed of kind.parse(item, op, sheets)) ops.push(parsed);
  }
  return ops;
}
