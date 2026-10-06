// Shared plumbing of the Data tools (Remove Duplicates, Text to Columns,
// Subtotal): read the selection's CURRENT values from the editor's live
// snapshot, and write a rewritten rectangle back as one
// `sheet.command.set-range-values` (the allowlisted cell-edit command the
// journal saves) inside a single undo step.
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { XLSX_CLIENT_MAX_EDIT_OPS } from "../../xlsx-clipboard";
import { toA1Address } from "../../xlsx-render-model-bridge";
import type { XlsxSelectionSpan } from "../structure-insert";
import type { XlsxToolbarCommands, XlsxToolbarCommandStep } from "../types";

export const XLSX_SET_RANGE_VALUES_COMMAND = "sheet.command.set-range-values";

/** One save job edits at most this many cells; a Data tool never writes part
 *  of a range. */
export const XLSX_DATA_TOOLS_MAX_CELLS = XLSX_CLIENT_MAX_EDIT_OPS;

/** The live cells of `span` on the sheet named `sheet` (row-major, `null` for
 *  an empty cell), or null when the snapshot has no such sheet. */
export function readSpanCells(
  snapshot: XlsxWorkbookSnapshot | null | undefined,
  sheet: string,
  span: Pick<XlsxSelectionSpan, "startRow" | "endRow" | "startColumn" | "endColumn">,
): (XlsxCellState | null)[][] | null {
  const model = snapshot?.sheets.find((candidate) => candidate.name === sheet || candidate.id === sheet);
  if (!model) return null;
  const rows: (XlsxCellState | null)[][] = [];
  for (let row = span.startRow; row <= span.endRow; row += 1) {
    const cells: (XlsxCellState | null)[] = [];
    for (let column = span.startColumn; column <= span.endColumn; column += 1) {
      cells.push(model.cells[toA1Address(row, column)] ?? null);
    }
    rows.push(cells);
  }
  return rows;
}

/** True when the cell holds nothing (no value and no formula). */
export function isBlankCell(cell: XlsxCellState | null): boolean {
  return cell === null || ((cell.value === null || cell.value === "") && !cell.formula);
}

/** Univer CellValueType: 1 string, 2 number, 3 boolean. */
const CELL_STRING = 1;
const CELL_NUMBER = 2;
const CELL_BOOLEAN = 3;

/** A live cell's VALUE as Univer cell data, keeping its type (a text "12"
 *  stays text); null/empty clears the cell's content (not its format). */
export function scalarCellData(value: XlsxCellState["value"] | undefined): Record<string, unknown> {
  const cleared = { f: null, p: null, si: null };
  if (value === null || value === undefined || value === "") return { ...cleared, v: null };
  if (typeof value === "number") return { ...cleared, v: value, t: CELL_NUMBER };
  if (typeof value === "boolean") return { ...cleared, v: value ? 1 : 0, t: CELL_BOOLEAN };
  return { ...cleared, v: value, t: CELL_STRING };
}

/** The set-range-values step writing `values` (row-major Univer cell data)
 *  with its top-left at (`startRow`, `startColumn`). */
export function writeValuesStep(
  unitId: string,
  subUnitId: string,
  startRow: number,
  startColumn: number,
  values: readonly (readonly Record<string, unknown>[])[],
): XlsxToolbarCommandStep {
  const value: Record<string, Record<string, Record<string, unknown>>> = {};
  let endColumn = startColumn;
  values.forEach((cells, rowIndex) => {
    const row: Record<string, Record<string, unknown>> = {};
    cells.forEach((cell, columnIndex) => {
      row[String(startColumn + columnIndex)] = cell;
      endColumn = Math.max(endColumn, startColumn + columnIndex);
    });
    value[String(startRow + rowIndex)] = row;
  });
  const range = { startRow, endRow: startRow + Math.max(0, values.length - 1), startColumn, endColumn };
  return { id: XLSX_SET_RANGE_VALUES_COMMAND, params: { unitId, subUnitId, range, value } };
}

/** Runs the steps as ONE undo entry when the port can batch, else one by one;
 *  resolves false when a step is refused (the renderer policy decides). */
export async function runDataToolSteps(commands: XlsxToolbarCommands, steps: readonly XlsxToolbarCommandStep[]): Promise<boolean> {
  try {
    if (commands.executeAsOneStep) return await commands.executeAsOneStep(steps);
    for (const step of steps) {
      if (!(await commands.execute(step.id, step.params))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
