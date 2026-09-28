// Recalculation orchestration — browser-safe planning half of the native
// recalc path. The Rust sidecar (bound by src/node) owns the engine; this
// file decides WHICH cells to read back and how a recalc answer becomes the
// <v> the save writes.
//
// Wire bounds the planner respects (apps/sheets/native/xlsx-engine):
//   recalc.rs:24  edits per request ≤ 10_000
//   recalc.rs:25  summed read cells per request ≤ 20_000
//   lib.rs:47     a single read range ≤ 100_000 cells
// Reads are grouped into request batches; the port issues one recalc_cells
// per batch and concatenates the answers.
import {
  XlsxEngineError,
  type XlsxCellRange,
  type XlsxFormulaValue,
  type XlsxRecalcCell,
  type XlsxRecalcEdit,
  type XlsxRecalcRead,
  type XlsxRecalcResult,
  type XlsxSheetFormulaValues,
} from "./engine.ts";

/** Sidecar wire bounds (recalc.rs:24-25). */
export const XLSX_MAX_RECALC_EDITS = 10_000;
export const XLSX_MAX_RECALC_READ_CELLS = 20_000;
/** Per-range bound (lib.rs:47). */
export const XLSX_MAX_RANGE_CELLS = 100_000;

interface FormulaCell {
  readonly sheetName: string;
  readonly row: number;
  readonly column: number;
}

const boxCells = (r: XlsxCellRange) =>
  (r.endRow - r.startRow + 1) * (r.endColumn - r.startColumn + 1);

/**
 * Read ranges for one request, ≤ XLSX_MAX_RANGE_CELLS each: one bounding box
 * per sheet over the post-edit formula cells ∪ edited cells, split into row
 * bands when the spread overflows the per-request budget. Returns batches —
 * each inner array stays under the summed-cell budget.
 */
export function buildRecalcReadBatches(
  cells: readonly FormulaCell[],
  edits: readonly XlsxRecalcEdit[],
): XlsxRecalcRead[][] {
  const bySheet = new Map<string, { minRow: number; maxRow: number; minCol: number; maxCol: number }>();
  const grow = (sheet: string, row: number, column: number) => {
    const box = bySheet.get(sheet) ?? { minRow: row, maxRow: row, minCol: column, maxCol: column };
    box.minRow = Math.min(box.minRow, row);
    box.maxRow = Math.max(box.maxRow, row);
    box.minCol = Math.min(box.minCol, column);
    box.maxCol = Math.max(box.maxCol, column);
    bySheet.set(sheet, box);
  };
  for (const c of cells) grow(c.sheetName, c.row, c.column);
  for (const e of edits) grow(e.sheet, e.row, e.column);

  const batches: XlsxRecalcRead[][] = [];
  let batch: XlsxRecalcRead[] = [];
  let batchCells = 0;
  const push = (sheet: string, range: XlsxCellRange) => {
    const n = boxCells(range);
    if (batchCells + n > XLSX_MAX_RECALC_READ_CELLS && batch.length > 0) {
      batches.push(batch);
      batch = [];
      batchCells = 0;
    }
    batch.push({ sheet, range });
    batchCells += n;
  };

  for (const [sheet, box] of bySheet) {
    const width = box.maxCol - box.minCol + 1;
    if (width > XLSX_MAX_RANGE_CELLS) {
      throw new XlsxEngineError("engine_result_invalid", `xlsx read span wider than ${XLSX_MAX_RANGE_CELLS} columns on ${sheet}`);
    }
    if (width >= XLSX_MAX_RECALC_READ_CELLS) {
      // Column-span alone meets the budget: emit cell-size reads, batched.
      for (let row = box.minRow; row <= box.maxRow; row++) {
        for (let column = box.minCol; column <= box.maxCol; column++) {
          push(sheet, { startRow: row, endRow: row, startColumn: column, endColumn: column });
        }
      }
      continue;
    }
    // Widest row band that still fits the per-request cell budget (a band is
    // also under the per-range bound: rowsPerBand*width ≤ 20_000 < 100_000).
    const rowsPerBand = Math.max(1, Math.floor(XLSX_MAX_RECALC_READ_CELLS / width));
    for (let startRow = box.minRow; startRow <= box.maxRow; startRow += rowsPerBand) {
      push(sheet, {
        startRow,
        endRow: Math.min(box.maxRow, startRow + rowsPerBand - 1),
        startColumn: box.minCol,
        endColumn: box.maxCol,
      });
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** RecalcCell → FormulaCachedValue (xlsx-gateway.ts:183), the same reduction
 *  the upstream renderer performs: engine-typed errors carry {error}, numbers
 *  the raw value, TRUE/FALSE a boolean, empty a null, else the text. */
export function recalcCellValue(cell: XlsxRecalcCell): XlsxFormulaValue {
  if (cell.isError) return { error: cell.formatted };
  if (cell.number !== undefined) return cell.number;
  if (cell.formatted === "TRUE") return true;
  if (cell.formatted === "FALSE") return false;
  if (cell.formatted === "") return null;
  return cell.formatted;
}

export interface RecalcFormulaValues {
  readonly values: XlsxSheetFormulaValues[];
  /** Expected formula cells absent from the answer — the sidecar's deliberate
   *  engine gaps (recalc.rs:293-302: CELL("filename"), RATE(#NUM!)) plus any
   *  cell the engine stopped typing as a formula. They keep the file's own
   *  cached <v>; the caller surfaces the count as a warning. */
  readonly kept: number;
}

/**
 * Recalc answer → the save's formulaValues argument. Only cells the engine
 * still types as formulas get a <v> refresh — a literal the user typed over a
 * formula keeps the literal; a cell the engine skipped (its documented pinned
 * gaps) keeps the file's own cached value, which beats an error the upstream
 * engine would wrongly show.
 */
export function recalcToFormulaValues(
  expected: readonly FormulaCell[],
  result: XlsxRecalcResult,
): RecalcFormulaValues {
  const seen = new Map<string, XlsxRecalcCell>();
  for (const cell of result.cells) {
    seen.set(`${cell.sheet} ${cell.row},${cell.column}`, cell);
  }
  // Only a formula-typed answer covers an expected formula cell — a literal
  // answer at that coordinate (e.g. the engine deduplicated a cell whose r=
  // attribute disagreed with its row element onto a shifted address) cannot
  // refresh an <f> cell's cache, so the file's own <v> is kept and warned.
  const kept = expected.filter((c) => seen.get(`${c.sheetName} ${c.row},${c.column}`)?.isFormula !== true).length;
  const bySheet = new Map<string, { row: number; column: number; value: XlsxFormulaValue }[]>();
  for (const cell of result.cells) {
    if (!cell.isFormula) continue;
    const list = bySheet.get(cell.sheet) ?? [];
    list.push({ row: cell.row, column: cell.column, value: recalcCellValue(cell) });
    bySheet.set(cell.sheet, list);
  }
  return {
    values: [...bySheet.entries()].map(([sheetName, cells]) => ({ sheetName, cells })),
    kept,
  };
}
