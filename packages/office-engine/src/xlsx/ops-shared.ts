// XLSX op core — the shared vocabulary and helpers every op-family parser
// reads: the typed op union, the wire bounds, the A1/cell helpers and the
// shared target/attributes/axis checks. Split out of ops.ts (FIX-926-B) so
// ops.ts and the per-family parser modules stay under the max-lines budget;
// ops.ts re-exports the public names, so the module surface is unchanged.
import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import type { XlsxCellScalar, XlsxCellState, XlsxGatewayArguments } from "./engine.ts";
import type { XlsxPageSetupOp } from "./page-setup.ts";
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

export type Dict = Record<string, unknown>;
export const isDict = (v: unknown): v is Dict => v !== null && typeof v === "object" && !Array.isArray(v);

/** Cheap text bound — the envelope caps total bytes, but one cell's text still
 *  gets its own ceiling so a malformed op fails before any engine call. */
const MAX_TEXT_LEN = 1 << 20;

/** OOXML grid bounds (ECMA-376): rows 1..1048576, columns A..XFD. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;
/** Row height (points) / column width (character units) ceiling, mirroring
 *  the upstream structural wire schema (desktop-api.ts structuralOps). */
export const MAX_AXIS_SIZE = 500;
/** Span ceiling a size/hidden/outline op may address (same wire schema). */
export const MAX_AXIS_SPAN = 100_000;
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

export function int(v: unknown, op: string, f: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new XlsxOpError(op, f, "integer required");
  return v;
}

export function str(v: unknown, op: string, f: string): string {
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

export function parseRange(item: Dict, op: string, sheets: XlsxSheetResolver): { sheetName: string; rows: number[]; columns: number[] } {
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

export function parseSetCell(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
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

export function parseClearCell(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  return [{ kind: "clear_cell", target: parseTarget(item, op, sheets), recalcInput: "" }];
}

export function parseSetCells(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
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

export function parseStructuralTarget(item: Dict, op: string, sheets: XlsxSheetResolver): string {
  if (!isDict(item.target)) throw new XlsxOpError(op, "target", "object required");
  return parseSheet(item.target, op, sheets);
}

export function parseStructuralAttributes(item: Dict, op: string): Dict {
  if (!isDict(item.attributes)) throw new XlsxOpError(op, "attributes", "object required");
  return item.attributes;
}

/** Rows kinds bound to MAX_ROWS; every other structural kind is a column
 *  kind bound to MAX_COLS. */
export function axisLimitOf(op: string): number {
  return op.includes("row") ? MAX_ROWS : MAX_COLS;
}

export function axisSpan(start: number, end: number, op: string, axisMax: number): void {
  if (start < 0 || end < 0 || end < start) throw new XlsxOpError(op, "attributes", "reversed or negative span");
  if (end >= axisMax) throw new XlsxOpError(op, "attributes", "span is outside the OOXML grid");
  if (end - start >= MAX_AXIS_SPAN) {
    throw new XlsxOpError(op, "attributes", `span over ${MAX_AXIS_SPAN} lines`);
  }
}
