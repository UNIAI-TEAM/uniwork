// Excel's Data > Outline > Subtotal, planned over the live values of the
// selected list (header row + data rows): the data rows are grouped by runs of
// equal values in the "At each change in" column; one sheet row is inserted
// under every group (bottom-up, so the original indices above stay valid) and
// one grand-total row after the list. The new rows get a label and
// `=SUBTOTAL(n, …)` formulas over the group's detail rows at their FINAL
// coordinates (the grand row's range includes the group rows: SUBTOTAL skips
// nested SUBTOTALs). Then the outline: data + subtotal rows one level, each
// group's detail rows one more. Every step runs in one batch = one undo step.
// "Replace current subtotals" and page breaks between groups are not offered.
import type { XlsxCellState } from "@uniwork/office-engine/xlsx";
import { XLSX_RANGE_TYPE } from "../../selection-mapping";
import { toA1Address } from "../../xlsx-render-model-bridge";
import type { XlsxSelectionSpan } from "../structure-insert";
import type { XlsxToolbarCommandStep } from "../types";
import { XLSX_DATA_TOOLS_MAX_CELLS, XLSX_SET_RANGE_VALUES_COMMAND, scalarCellData } from "./range-values";

/** The functions the dialog offers, with Excel's SUBTOTAL function number
 *  (Count is COUNTA, as in Excel's Subtotal dialog). */
export const SUBTOTAL_FUNCTIONS = { sum: 9, count: 3, average: 1, max: 4, min: 5, product: 6 } as const;

export type XlsxSubtotalFunction = keyof typeof SUBTOTAL_FUNCTIONS;

const XLSX_INSERT_ROW_COMMAND = "sheet.command.insert-row";

/** The controller's row outline command (structure-outline.tsx
 *  `outlineCommandId("rows")`; not imported, that module mounts this tool):
 *  "group" raises every line of the span by one level. */
const XLSX_ROWS_OUTLINE_COMMAND = "uniwork.command.set-rows-outline";

/** Univer `Direction.DOWN`: the new row sits below the anchor row
 *  (`range.startRow - 1`) and takes its height. */
const DIRECTION_DOWN = 2;

interface XlsxSubtotalOptions {
  /** 0-based column inside the selection whose value changes delimit groups. */
  readonly changeColumn: number;
  readonly fn: XlsxSubtotalFunction;
  /** 0-based columns inside the selection that get a SUBTOTAL formula. */
  readonly columns: readonly number[];
}

interface XlsxSubtotalLabels {
  /** The label of a group row for the group's value. */
  readonly group: (value: string) => string;
  /** The label of the grand-total row. */
  readonly grand: string;
}

interface XlsxSubtotalGroup {
  /** The group's value as shown in its label. */
  readonly value: string;
  /** 0-based sheet rows of the group's detail rows, after the inserts. */
  readonly firstRow: number;
  readonly lastRow: number;
  /** 0-based sheet row of the inserted subtotal row. */
  readonly subtotalRow: number;
}

interface XlsxSubtotalPlan {
  readonly steps: readonly XlsxToolbarCommandStep[];
  readonly groups: readonly XlsxSubtotalGroup[];
  /** 0-based sheet row of the grand-total row, after the inserts. */
  readonly grandRow: number;
  /** Sheet rows inserted (one per group + the grand total). */
  readonly insertedRows: number;
}

type XlsxSubtotalRefusal = "needRows" | "noColumns" | "limitExceeded";

/** Same comparison as Remove Duplicates: values, text case-insensitively. */
function keyOf(cell: XlsxCellState | null): string {
  const value = cell?.value ?? null;
  if (value === null || value === "") return "e:";
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  return `s:${value.toLocaleLowerCase()}`;
}

function displayOf(cell: XlsxCellState | null): string {
  const value = cell?.value ?? null;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function columnLetter(column: number): string {
  return toA1Address(0, column).replace(/[0-9]+$/, "");
}

/** Univer WrapStrategy.OVERFLOW: a label longer than its column spills into the
 *  empty neighbour (or clips) instead of wrapping, which would grow the row. */
const WRAP_OVERFLOW = 1;

/** A label cell: its text plus an explicit no-wrap style, written in the same
 *  set-range-values batch (one undo step). */
function labelCell(label: string): Record<string, unknown> {
  return { ...scalarCellData(label), s: { tb: WRAP_OVERFLOW } };
}

function formulaCell(fn: XlsxSubtotalFunction, column: number, firstRow: number, lastRow: number): Record<string, unknown> {
  const letter = columnLetter(column);
  return { f: `=SUBTOTAL(${SUBTOTAL_FUNCTIONS[fn]},${letter}${firstRow + 1}:${letter}${lastRow + 1})`, v: null, p: null, si: null };
}

export function planSubtotal(
  cells: readonly (readonly (XlsxCellState | null)[])[],
  options: XlsxSubtotalOptions,
  span: Pick<XlsxSelectionSpan, "startRow" | "startColumn" | "endColumn">,
  target: { readonly unitId: string; readonly sheetId: string },
  labels: XlsxSubtotalLabels,
): XlsxSubtotalPlan | XlsxSubtotalRefusal {
  const data = cells.slice(1);
  if (data.length === 0) return "needRows";
  if (options.columns.length === 0) return "noColumns";
  const { unitId, sheetId } = target;
  const firstData = span.startRow + 1;
  const lastData = span.startRow + data.length;

  // Runs of equal change-column values, in original sheet rows.
  const runs: { first: number; last: number; value: string }[] = [];
  let previous: string | null = null;
  data.forEach((row, index) => {
    const cell = row[options.changeColumn] ?? null;
    const key = keyOf(cell);
    const sheetRow = firstData + index;
    const current = runs[runs.length - 1];
    if (current && key === previous) current.last = sheetRow;
    else runs.push({ first: sheetRow, last: sheetRow, value: displayOf(cell) });
    previous = key;
  });

  const insertedRows = runs.length + 1;
  const labelled = options.columns.includes(options.changeColumn) ? 0 : 1;
  const written = insertedRows * (options.columns.length + labelled);
  if (insertedRows + written > XLSX_DATA_TOOLS_MAX_CELLS) return "limitExceeded";

  const insertAt = (row: number): XlsxToolbarCommandStep => ({
    id: XLSX_INSERT_ROW_COMMAND,
    params: {
      unitId,
      subUnitId: sheetId,
      direction: DIRECTION_DOWN,
      range: { startRow: row, endRow: row, startColumn: span.startColumn, endColumn: span.endColumn, rangeType: XLSX_RANGE_TYPE.ROW },
    },
  });
  // Bottom-up in original coordinates: the grand row first, then each group's
  // row below its last detail row (the grand row is pushed down by the last).
  const inserts = [insertAt(lastData + 1), ...[...runs].reverse().map((run) => insertAt(run.last + 1))];

  const groups: XlsxSubtotalGroup[] = runs.map((run, index) => ({
    value: run.value,
    firstRow: run.first + index,
    lastRow: run.last + index,
    subtotalRow: run.last + index + 1,
  }));
  const grandRow = lastData + runs.length + 1;

  const value: Record<string, Record<string, Record<string, unknown>>> = {};
  const writeRow = (row: number, label: string, firstRow: number, lastRow: number) => {
    const cellsOfRow: Record<string, Record<string, unknown>> = {};
    if (labelled) cellsOfRow[String(span.startColumn + options.changeColumn)] = labelCell(label);
    for (const column of options.columns) {
      const sheetColumn = span.startColumn + column;
      cellsOfRow[String(sheetColumn)] = formulaCell(options.fn, sheetColumn, firstRow, lastRow);
    }
    value[String(row)] = cellsOfRow;
  };
  for (const group of groups) writeRow(group.subtotalRow, labels.group(group.value), group.firstRow, group.lastRow);
  writeRow(grandRow, labels.grand, firstData, grandRow - 1);
  const touched = [...options.columns, ...(labelled ? [options.changeColumn] : [])].map((column) => span.startColumn + column);
  const write: XlsxToolbarCommandStep = {
    id: XLSX_SET_RANGE_VALUES_COMMAND,
    params: {
      unitId,
      subUnitId: sheetId,
      range: { startRow: groups[0]!.subtotalRow, endRow: grandRow, startColumn: Math.min(...touched), endColumn: Math.max(...touched) },
      value,
    },
  };

  const outline = (startRow: number, endRow: number): XlsxToolbarCommandStep => ({
    id: XLSX_ROWS_OUTLINE_COMMAND,
    params: { subUnitId: sheetId, start: startRow, end: endRow, action: "group" },
  });
  const outlines = [outline(firstData, grandRow - 1), ...groups.map((group) => outline(group.firstRow, group.lastRow))];

  return { steps: [...inserts, write, ...outlines], groups, grandRow, insertedRows };
}
