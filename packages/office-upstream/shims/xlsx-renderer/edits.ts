import {
  recordSetNumfmt,
  recordSetRangeValues,
} from "../../upstream/apps/sheets/src/renderer/edit-journal";
import type { SharedFormulaResolver } from "../../upstream/apps/sheets/src/renderer/shared-formula-journal";
import type { LazyWorkbookState } from "../../upstream/apps/sheets/src/renderer/univer-state";
import type { IExecutionOptions } from "@univerjs/core";

export interface XlsxRendererCellEdit {
  sheetId: string;
  row: number;
  column: number;
  writeValue: boolean;
  value: string | number | boolean | null;
  formula?: string;
  style?: Record<string, unknown>;
  styleReset?: boolean;
}

export interface RendererCommand {
  id: string;
  type?: number;
  params?: unknown;
  options?: IExecutionOptions;
}

export const CELL_MUTATIONS = new Set([
  "sheet.mutation.set-range-values",
  "sheet.mutation.set.numfmt",
  "sheet.mutation.remove.numfmt",
]);

/** Ingest only bound user mutations; undo/redo execute these same mutations. */
export function ingestCellMutation(
  state: LazyWorkbookState | null,
  event: RendererCommand,
  suppressed = false,
  resolveSharedFormula?: SharedFormulaResolver,
  readStyle?: (row: number, column: number) => Record<string, unknown> | undefined,
): XlsxRendererCellEdit[] {
  if (!state || suppressed || event.options?.fromFormula || !CELL_MUTATIONS.has(event.id)) return [];
  const params = event.params as {
    unitId?: string; subUnitId?: string; cellValue?: unknown; ranges?: unknown;
  } | undefined;
  const sheetId = params?.subUnitId;
  if (!params || params.unitId !== `file-${state.file.sha256}` || !sheetId ||
      !state.file.sheets.some((sheet) => sheet.id === sheetId)) return [];
  const before = new Map(state.editJournal.cells.get(sheetId));
  let recorded;
  if (event.id === "sheet.mutation.set.numfmt") {
    recorded = recordSetNumfmt(state.editJournal, sheetId, params);
  } else if (event.id === "sheet.mutation.remove.numfmt") {
    // Univer undoes a newly applied format by removing its numfmt entry.
    // The gateway's equivalent restoration is the default General format.
    recorded = recordSetNumfmt(state.editJournal, sheetId, {
      refMap: { general: { pattern: "General" } },
      values: { general: { ranges: params.ranges } },
    });
  } else {
    let cells = params.cellValue;
    if (cells && typeof cells === "object" && readStyle) {
      const normalized: Record<string, Record<string, unknown>> = {};
      for (const [row, values] of Object.entries(cells)) {
        if (!values || typeof values !== "object") continue;
        normalized[row] = {};
        for (const [column, cell] of Object.entries(values)) {
          let data = cell;
          if (cell && typeof cell === "object" && "s" in cell) {
            const style = (cell as { s?: unknown }).s;
            if (typeof style === "string") {
              data = { ...cell, s: readStyle(Number(row), Number(column)) ?? null };
            } else if (style && typeof style === "object" && Object.values(style).some((v) => v === null)) {
              // Null style attributes in undo mean removal. The vendored
              // converter cannot express every removal (e.g. fs:null), so
              // restore the complete post-mutation cell style after reset.
              recordSetRangeValues(state.editJournal, sheetId, { [row]: { [column]: { s: null } } });
              data = { ...cell, s: readStyle(Number(row), Number(column)) ?? null };
            }
          }
          normalized[row][column] = data;
        }
      }
      cells = normalized;
    }
    recorded = recordSetRangeValues(state.editJournal, sheetId, cells, resolveSharedFormula);
  }
  const changed = new Map<string, XlsxRendererCellEdit>();
  for (const entry of recorded) {
    const key = `${entry.row}:${entry.column}`;
    if (JSON.stringify(before.get(key)) === JSON.stringify(entry)) continue;
    changed.set(key, {
      sheetId, row: entry.row, column: entry.column,
      writeValue: entry.hasValue, value: entry.value,
      ...(entry.formula === undefined ? {} : { formula: entry.formula }),
      ...(entry.style === undefined ? {} : { style: { ...entry.style } }),
      ...(entry.styleReset ? { styleReset: true } : {}),
    });
  }
  return [...changed.values()];
}
