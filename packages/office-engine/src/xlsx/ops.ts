// Envelope edits[] → typed XLSX ops. Each item is {op, target, text, style,
// attributes} per the contract's EDIT_FIELDS; the op vocabulary is this lane's
// (set_cell / clear_cell / set_cells). A malformed item is a typed XlsxOpError,
// never a silent drop — the caller's ops either all parse or the job fails
// before a byte is touched.
import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import type { XlsxCellScalar, XlsxCellState } from "./engine.ts";

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
const A1 = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/;

export interface XlsxCellTarget {
  readonly sheetName: string;
  /** 0-based row/column, matching every engine wire surface. */
  readonly row: number;
  readonly column: number;
  /** A1 spelling, for messages and the model's cell map. */
  readonly address: string;
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
  | { readonly kind: "clear_cell"; readonly target: XlsxCellTarget; readonly recalcInput: "" };

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

/**
 * Fold a validated envelope edits array into typed ops. Unknown op names are
 * a typed error (unsupported): the caller learns the vocabulary is narrower
 * than upstream's full sheet-op set, not that its op vanished.
 */
export function parseXlsxOps(edits: unknown[], sheets: XlsxSheetResolver): XlsxEditOp[] {
  if (edits.length > ENGINE_LIMITS.max_edit_ops) {
    throw new XlsxOpError("<edits>", "", `at most ${ENGINE_LIMITS.max_edit_ops} ops per job`);
  }
  const ops: XlsxEditOp[] = [];
  for (const item of edits) {
    if (!isDict(item)) throw new XlsxOpError("<item>", "", "object required");
    const op = str(item.op, "<item>", "op");
    switch (op) {
      case "set_cell": {
        const target = parseTarget(item, op, sheets);
        const { cell, writeValue } = parseCellValue(item, op);
        const { style, styleReset } = parseStyle(item, op);
        if (!writeValue && style === undefined && styleReset === undefined) {
          throw new XlsxOpError(op, "text", "set_cell needs text, attributes.value/formula, or a style");
        }
        ops.push({
          kind: "set_cell",
          target,
          cell,
          writeValue,
          style,
          styleReset,
          // Style-only edits are invisible to the recalc model.
          recalcInput: writeValue ? recalcInputFor(cell) : "",
        });
        break;
      }
      case "clear_cell": {
        ops.push({ kind: "clear_cell", target: parseTarget(item, op, sheets), recalcInput: "" });
        break;
      }
      case "set_cells": {
        const { sheetName, rows, columns } = parseRange(item, op, sheets);
        const { cell, writeValue } = parseCellValue(item, op);
        if (!writeValue) throw new XlsxOpError(op, "text", "set_cells needs text or attributes.value/formula");
        const { style, styleReset } = parseStyle(item, op);
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
        break;
      }
      default:
        throw new XlsxOpError(op, "", "unknown op for xlsx (bound: set_cell, clear_cell, set_cells)", true);
    }
  }
  return ops;
}
