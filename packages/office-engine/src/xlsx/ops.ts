// Envelope edits[] → typed XLSX ops. Each item is {op, target, text, style,
// attributes} per the contract's EDIT_FIELDS; the op vocabulary is this lane's
// (set_cell / clear_cell / set_cells). A malformed item is a typed XlsxOpError,
// never a silent drop — the caller's ops either all parse or the job fails
// before a byte is touched.
import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import type { XlsxCellScalar, XlsxCellState, XlsxGatewayArguments } from "./engine.ts";
import { PAGE_SETUP_OP_KIND, type XlsxPageSetupFields, type XlsxPageSetupOp } from "./page-setup.ts";

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

/** One custom filter condition — the upstream FilterColumnState.customs entry
 *  (xlsx-filter.ts): a value and an optional OOXML comparison operator
 *  (absent = equality). */
export interface XlsxFilterCustomCondition {
  readonly val: string | number;
  readonly operator?: string | undefined;
}

/** One filter column's criteria; colId is the 0-based offset inside the filter
 *  range (OOXML filterColumn/@colId). Exactly one of values/blank/customs is
 *  present, mirroring the vendored wire schema. */
export interface XlsxFilterColumnState {
  readonly colId: number;
  readonly values?: readonly string[] | undefined;
  readonly blank?: boolean | undefined;
  readonly customs?: { readonly and?: boolean | undefined; readonly filters: readonly XlsxFilterCustomCondition[] } | undefined;
}

/** The declarative filter snapshot of one sheet (upstream SheetFilterState,
 *  minus the sheet name the envelope target carries). `range` is owned by the
 *  sheet (`<autoFilter ref>`), not the selection. */
export interface XlsxFilterSetState {
  readonly range: XlsxMergeArea;
  readonly columns: readonly XlsxFilterColumnState[];
}

/** Filter ops (envelope `filterStates` slot). `set_filter` is a whole-sheet
 *  declarative snapshot; `clear_filter` removes the autoFilter and unhides the
 *  rows inside `visibilityRange` (the range the removed filter was hiding).
 *  The model folds both per sheet, last write wins, in emission order — the
 *  gateway applies the final states after structural replay and cell edits. */
export type XlsxFilterOp =
  | {
      readonly kind: "set_filter";
      readonly sheetName: string;
      readonly filter: XlsxFilterSetState;
      readonly hiddenRows: readonly number[];
      readonly visibilityRange: XlsxMergeArea;
    }
  | {
      readonly kind: "clear_filter";
      readonly sheetName: string;
      readonly visibilityRange: XlsxMergeArea;
    };

/** The gateway's SheetFilterState: one sheet's declarative filter state
 *  (xlsx-filter.ts), the shape of the `filterStates` argument. */
export interface XlsxSheetFilterState {
  readonly sheetName: string;
  readonly filter: XlsxFilterSetState | null;
  readonly hiddenRows: readonly number[];
  readonly visibilityRange: XlsxMergeArea;
}

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

/** The bound sheet-op wire vocabulary; the session model's sheet registry
 *  keys on it. */
const SHEET_OP_KIND_LIST = [
  "add_sheet",
  "duplicate_sheet",
  "rename_sheet",
  "remove_sheet",
  "reorder_sheet",
  "set_sheet_hidden",
] as const;

const SHEET_KIND_SET: ReadonlySet<string> = new Set(SHEET_OP_KIND_LIST);

export function isXlsxSheetOp(op: XlsxEditOp): op is XlsxSheetOp {
  return SHEET_KIND_SET.has(op.kind);
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

/** The bound filter wire vocabulary; the model's last-write-per-sheet fold
 *  keys on it. */
const FILTER_OP_KIND_LIST = ["set_filter", "clear_filter"] as const;

const FILTER_KIND_SET: ReadonlySet<string> = new Set(FILTER_OP_KIND_LIST);

export function isXlsxFilterOp(op: XlsxEditOp): op is XlsxFilterOp {
  return FILTER_KIND_SET.has(op.kind);
}

/** Fold filter ops per sheet in emission order, last write wins (the plan is
 *  whole-sheet, like sheetPlan). A `clear_filter` folds to the gateway's
 *  `filter: null` state, which removes the sheet's autoFilter and unhides the
 *  data rows inside `visibilityRange`. First-touch sheet order is kept; the
 *  gateway applies each state independently. */
export function groupXlsxFilterStates(ops: readonly XlsxEditOp[]): XlsxSheetFilterState[] {
  const bySheet = new Map<string, XlsxSheetFilterState>();
  for (const op of ops) {
    if (!isXlsxFilterOp(op)) continue;
    bySheet.set(
      op.sheetName,
      op.kind === "set_filter"
        ? { sheetName: op.sheetName, filter: op.filter, hiddenRows: op.hiddenRows, visibilityRange: op.visibilityRange }
        : { sheetName: op.sheetName, filter: null, hiddenRows: [], visibilityRange: op.visibilityRange },
    );
  }
  return [...bySheet.values()];
}

/** One worksheet-level op (envelope `sheetPlan` slot): add, duplicate, rename,
 *  remove, reorder, show/hide. Names are the wire identity and every op
 *  addresses a sheet by its CURRENT name at emission time — the session model
 *  applies sheet ops in emission order, so an op after a rename resolves to
 *  the new name (live `XlsxSheetResolver`). All sheet ops of one session fold
 *  into ONE gateway SheetEditPlan rebuilt from the final model state at save
 *  time (model.pendingSheetPlan). `index` is the 0-based final tab position
 *  (add/duplicate default to the end). */
export type XlsxSheetOp =
  | { readonly kind: "add_sheet"; readonly name: string; readonly index?: number | undefined }
  | { readonly kind: "duplicate_sheet"; readonly sheetName: string; readonly name: string; readonly index?: number | undefined }
  | { readonly kind: "rename_sheet"; readonly sheetName: string; readonly newName: string }
  | { readonly kind: "remove_sheet"; readonly sheetName: string }
  | { readonly kind: "reorder_sheet"; readonly sheetName: string; readonly index: number }
  | { readonly kind: "set_sheet_hidden"; readonly sheetName: string; readonly hidden: boolean };

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
  | XlsxStructuralOp
  | XlsxFilterOp
  | XlsxPageSetupOp
  | XlsxSheetOp;

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

function parseSetFilter(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
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

function parseClearFilter(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  return [{ kind: "clear_filter", sheetName, visibilityRange: parseFilterArea(a.visibilityRange, op, "attributes.visibilityRange") }];
}

// ── page setup (pageSetupStates slot) ─────────────────────────────────────
//
// Wire shape: { op: "set_page_setup", target: { sheet }, attributes: { ... } }.
// The whole declarative snapshot rides the raw attributes object like the
// structural kinds; the parser is strict (unknown or malformed fields are a
// typed error, never a silent drop) and normalizes to the upstream
// SheetPageSetupState vocabulary (xlsx-page-setup.ts). A field absent from the
// attributes is absent from the op, so the gateway leaves the file's value
// verbatim; a field present with the wrong type or range is refused here.

/** OOXML paper-size codes the gateway/desktop schema accepts (1..118). */
const MAX_PAPER_SIZE = 118;
/** sheetView zoom / page scale percent bound (10..400). */
const MIN_PAGE_SCALE = 10;
const MAX_PAGE_SCALE = 400;
/** Fit-to-page counts are 0 (automatic) .. 1000. */
const MAX_FIT_TO = 1_000;
/** A print-title row span like "1:3" (1-based, ascending). */
const PRINT_TITLES = /^(\d{1,7}):(\d{1,7})$/;

function pageSetupBool(a: Dict, key: string, op: string): boolean | undefined {
  if (a[key] === undefined) return undefined;
  if (typeof a[key] !== "boolean") throw new XlsxOpError(op, "attributes." + key, "boolean required");
  return a[key];
}

function pageSetupInt(a: Dict, key: string, op: string, min: number, max: number): number | undefined {
  if (a[key] === undefined) return undefined;
  const value = int(a[key], op, "attributes." + key);
  if (value < min || value > max) throw new XlsxOpError(op, "attributes." + key, "integer " + min + "-" + max + " required");
  return value;
}

function pageSetupEnum<T extends string>(a: Dict, key: string, op: string, allowed: readonly T[]): T | undefined {
  if (a[key] === undefined) return undefined;
  const value = str(a[key], op, "attributes." + key);
  if (!(allowed as readonly string[]).includes(value)) throw new XlsxOpError(op, "attributes." + key, "one of " + allowed.join(", "));
  return value as T;
}

/** A print area: the A1 grammar the upstream toAbsoluteRange accepts, with the
 *  upstream's 255-character bound. null clears the defined name. */
function pageSetupPrintArea(a: Dict, op: string): string | null | undefined {
  if (a.printArea === undefined) return undefined;
  if (a.printArea === null) return null;
  const value = str(a.printArea, op, "attributes.printArea");
  if (value.length === 0 || value.length > 255 || !/^[$A-Za-z0-9:]+$/.test(value)) {
    throw new XlsxOpError(op, "attributes.printArea", "an A1 range like A1:C10 (or null) required");
  }
  const parts = value.split(":");
  for (const part of parts) a1ToRowColumn(part, op, "attributes.printArea");
  return value;
}

/** Print titles: a row span "1:3" (the only spelling upstream
 *  toAbsoluteRowSpan accepts), or null to clear. */
function pageSetupPrintTitles(a: Dict, op: string): string | null | undefined {
  if (a.printTitles === undefined) return undefined;
  if (a.printTitles === null) return null;
  const value = str(a.printTitles, op, "attributes.printTitles");
  const match = PRINT_TITLES.exec(value);
  const start = match ? Number(match[1]) : 0;
  const end = match ? Number(match[2]) : 0;
  if (!match || start < 1 || start > end || end > MAX_ROWS) {
    throw new XlsxOpError(op, "attributes.printTitles", "a row span like 1:3 (or null) required");
  }
  return value;
}

/** One manual-break array. The upstream sorts and de-dupes; every id here must
 *  be a positive in-grid index. */
function pageSetupBreaks(a: Dict, key: "rowBreaks" | "colBreaks", op: string, max: number): number[] | undefined {
  if (a[key] === undefined) return undefined;
  if (!Array.isArray(a[key]) || a[key].length > 1_023) {
    throw new XlsxOpError(op, "attributes." + key, "at most 1023 break indexes");
  }
  return a[key].map((entry) => {
    const value = int(entry, op, "attributes." + key);
    if (value < 1 || value > max) throw new XlsxOpError(op, "attributes." + key, "break index 1-" + max + " required");
    return value;
  });
}

/** The page-setup attribute vocabulary (the typed op's own fields). An unknown
 *  attribute would be silently dropped by the typed op, so it is refused. */
const PAGE_SETUP_FIELDS: ReadonlySet<string> = new Set([
  "orientation", "paperSize", "scale", "fitToWidth", "fitToHeight", "fitToPage", "margins",
  "printGridlines", "printHeadings", "printArea", "printTitles",
  "frozenRows", "frozenColumns", "rowBreaks", "colBreaks",
]);

function parseSetPageSetup(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  for (const key of Object.keys(a)) {
    if (!PAGE_SETUP_FIELDS.has(key)) throw new XlsxOpError(op, "attributes." + key, "unknown page-setup field");
  }
  // The frozen pane is one state with two axes: the gateway's
  // applyPageSetupState writes `frozenRows ?? 0`/`frozenColumns ?? 0`, so a
  // lone axis would silently reset the other to 0. Require the pair, matching
  // the upstream workbookPageSetupStateSchema ("both present together").
  const frozenRows = pageSetupInt(a, "frozenRows", op, 0, MAX_ROWS - 1);
  const frozenColumns = pageSetupInt(a, "frozenColumns", op, 0, MAX_COLS - 1);
  if ((frozenRows === undefined) !== (frozenColumns === undefined)) {
    throw new XlsxOpError(op, "attributes.frozenRows", "frozenRows and frozenColumns must be set together");
  }
  const setup: XlsxPageSetupFields = {
    orientation: pageSetupEnum(a, "orientation", op, ["portrait", "landscape"] as const),
    paperSize: pageSetupInt(a, "paperSize", op, 1, MAX_PAPER_SIZE),
    scale: pageSetupInt(a, "scale", op, MIN_PAGE_SCALE, MAX_PAGE_SCALE),
    fitToWidth: pageSetupInt(a, "fitToWidth", op, 0, MAX_FIT_TO),
    fitToHeight: pageSetupInt(a, "fitToHeight", op, 0, MAX_FIT_TO),
    fitToPage: pageSetupBool(a, "fitToPage", op),
    margins: pageSetupEnum(a, "margins", op, ["normal", "wide", "narrow"] as const),
    printGridlines: pageSetupBool(a, "printGridlines", op),
    printHeadings: pageSetupBool(a, "printHeadings", op),
    printArea: pageSetupPrintArea(a, op),
    printTitles: pageSetupPrintTitles(a, op),
    frozenRows,
    frozenColumns,
    rowBreaks: pageSetupBreaks(a, "rowBreaks", op, MAX_ROWS - 1),
    colBreaks: pageSetupBreaks(a, "colBreaks", op, MAX_COLS - 1),
  };
  if (Object.values(setup).every((value) => value === undefined)) {
    throw new XlsxOpError(op, "attributes", "a page-setup op needs at least one setting");
  }
  return [{ kind: PAGE_SETUP_OP_KIND, sheetName, setup }];
}


// ── sheet ops (add / rename / remove / duplicate / reorder / hide) ─────────
//
// Wire shape mirrors B1/B2: { op, target: { sheet } , attributes: { ... } }.
// `add_sheet` has no sheet to address (target absent or empty). Names are
// validated against the upstream rules (validateSheetName, xlsx-sheets.ts):
// 1-31 characters, no \ / ? * [ ] :, no leading/trailing apostrophe, unique
// among the live sheets (case-insensitive, as Excel treats names). Every name
// check runs against the live resolver, so a name freed by an earlier removal
// in the same envelope is reusable and one taken by an earlier addition is
// not.

/** OOXML worksheet-name bound (validateSheetName). */
const MAX_SHEET_NAME_LEN = 31;
const INVALID_SHEET_NAME_CHARS = /[\\/?*[\]:]/;
/** Tab-position ceiling: an envelope carries at most max_edit_ops items, so a
 *  workbook with more sheets than that cannot be addressed in one save. */
const MAX_SHEET_INDEX = 9_999;

function parseSheetNameValue(raw: unknown, op: string, field: string): string {
  const name = str(raw, op, field);
  if (name.length === 0 || name.length > MAX_SHEET_NAME_LEN) {
    throw new XlsxOpError(op, field, `sheet name must be 1-${MAX_SHEET_NAME_LEN} characters`);
  }
  if (INVALID_SHEET_NAME_CHARS.test(name)) {
    throw new XlsxOpError(op, field, "sheet name cannot contain \\ / ? * [ ] :");
  }
  if (name.startsWith("'") || name.endsWith("'")) {
    throw new XlsxOpError(op, field, "sheet name cannot start or end with an apostrophe");
  }
  return name;
}

/** Refuses a name already taken by a live sheet. `except` exempts the sheet a
 *  rename is about, so a case-only rewrite stays a legal no-op. */
function assertSheetNameFree(
  name: string,
  op: string,
  field: string,
  sheets: XlsxSheetResolver,
  except?: string,
): void {
  const needle = name.toLowerCase();
  for (const existing of sheets.sheetNames()) {
    if (except !== undefined && existing === except) continue;
    if (existing.toLowerCase() === needle) {
      throw new XlsxOpError(op, field, `sheet name ${JSON.stringify(name)} is already used`);
    }
  }
}

function optionalSheetIndex(item: Dict, op: string): number | undefined {
  const a = parseStructuralAttributes(item, op);
  if (a.index === undefined) return undefined;
  const index = int(a.index, op, "attributes.index");
  if (index < 0 || index > MAX_SHEET_INDEX) {
    throw new XlsxOpError(op, "attributes.index", `index must be 0-${MAX_SHEET_INDEX}`);
  }
  return index;
}

function parseAddSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  if (item.target !== undefined && (!isDict(item.target) || Object.keys(item.target).length > 0)) {
    throw new XlsxOpError(op, "target", "add_sheet addresses no existing sheet");
  }
  const name = parseSheetNameValue(parseStructuralAttributes(item, op).name, op, "attributes.name");
  assertSheetNameFree(name, op, "attributes.name", sheets);
  const index = optionalSheetIndex(item, op);
  if (index !== undefined && index > sheets.sheetNames().length) {
    throw new XlsxOpError(op, "attributes.index", "index outside the tab range");
  }
  return [{ kind: "add_sheet", name, ...(index === undefined ? {} : { index }) }];
}

function parseDuplicateSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const name = parseSheetNameValue(parseStructuralAttributes(item, op).name, op, "attributes.name");
  assertSheetNameFree(name, op, "attributes.name", sheets);
  const index = optionalSheetIndex(item, op);
  if (index !== undefined && index > sheets.sheetNames().length) {
    throw new XlsxOpError(op, "attributes.index", "index outside the tab range");
  }
  return [{ kind: "duplicate_sheet", sheetName, name, ...(index === undefined ? {} : { index }) }];
}

function parseRenameSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const newName = parseSheetNameValue(parseStructuralAttributes(item, op).newName, op, "attributes.newName");
  assertSheetNameFree(newName, op, "attributes.newName", sheets, sheetName);
  return [{ kind: "rename_sheet", sheetName, newName }];
}

function parseRemoveSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  if (sheets.sheetNames().length <= 1) {
    throw new XlsxOpError(op, "target.sheet", "a workbook needs at least one sheet");
  }
  return [{ kind: "remove_sheet", sheetName }];
}

function parseReorderSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const attributes = parseStructuralAttributes(item, op);
  const index = int(attributes.index, op, "attributes.index");
  if (index < 0 || index >= sheets.sheetNames().length) {
    throw new XlsxOpError(op, "attributes.index", "index outside the tab range");
  }
  return [{ kind: "reorder_sheet", sheetName, index }];
}

function parseSheetHidden(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const attributes = parseStructuralAttributes(item, op);
  if (typeof attributes.hidden !== "boolean") {
    throw new XlsxOpError(op, "attributes.hidden", "boolean required");
  }
  return [{ kind: "set_sheet_hidden", sheetName, hidden: attributes.hidden }];
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
  { wireName: "set_filter", slot: "filterStates", parse: parseSetFilter },
  { wireName: "clear_filter", slot: "filterStates", parse: parseClearFilter },
  { wireName: "set_page_setup", slot: "pageSetupStates", parse: parseSetPageSetup },
  { wireName: "add_sheet", slot: "sheetPlan", parse: parseAddSheet },
  { wireName: "duplicate_sheet", slot: "sheetPlan", parse: parseDuplicateSheet },
  { wireName: "rename_sheet", slot: "sheetPlan", parse: parseRenameSheet },
  { wireName: "remove_sheet", slot: "sheetPlan", parse: parseRemoveSheet },
  { wireName: "reorder_sheet", slot: "sheetPlan", parse: parseReorderSheet },
  { wireName: "set_sheet_hidden", slot: "sheetPlan", parse: parseSheetHidden },
];

const OP_KIND_BY_NAME: ReadonlyMap<string, XlsxOpKind> = new Map(XLSX_OP_KINDS.map((kind) => [kind.wireName, kind]));

/**
 * Fold a validated envelope edits array into typed ops through the op-kind
 * registry. Unknown op names are a typed error (unsupported): the caller
 * learns the vocabulary is narrower than upstream's full sheet-op set, not
 * that its op vanished.
 *
 * `onOp` is the emission-order seam: when supplied, each op is handed over as
 * it is produced, BEFORE the next item parses. The session model uses it to
 * apply sheet ops while parsing — a later op's `target.sheet` must resolve
 * against a rename that an earlier op just applied (live resolver), and the
 * alternative (parse everything, then apply everything) cannot see it.
 */
export function parseXlsxOps(
  edits: unknown[],
  sheets: XlsxSheetResolver,
  onOp?: (op: XlsxEditOp) => void,
): XlsxEditOp[] {
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
    for (const parsed of kind.parse(item, op, sheets)) {
      ops.push(parsed);
      onOp?.(parsed);
    }
  }
  return ops;
}
