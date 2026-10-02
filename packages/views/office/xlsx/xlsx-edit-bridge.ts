import { toA1Address } from "./xlsx-render-model-bridge";

/** Serializable user edits emitted by the streamed grid, including undo. */
export interface XlsxGridCellEdit {
  sheetId: string;
  row: number;
  column: number;
  writeValue: boolean;
  value: string | number | boolean | null;
  formula?: string;
  style?: Record<string, unknown>;
  styleReset?: boolean;
}

interface CellOperation {
  op: "set_cell" | "clear_cell";
  target: { sheet: string; cell: string };
  attributes?: { value?: XlsxGridCellEdit["value"]; formula?: string; styleReset?: boolean };
  style?: Record<string, unknown>;
}

/** Keep the G2 vocabulary: a style-only edit must never overwrite a value. */
export function rendererEditsToOperations(
  sheets: readonly { id: string; name: string }[],
  edits: readonly XlsxGridCellEdit[],
): CellOperation[] {
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  return edits.map((edit) => {
    const sheet = names.get(edit.sheetId);
    if (!sheet) throw new Error("xlsx_edit_unknown_sheet");
    if (!Number.isSafeInteger(edit.row) || !Number.isSafeInteger(edit.column) || edit.row < 0 || edit.row >= 1_048_576 || edit.column < 0 || edit.column >= 16_384) throw new Error("xlsx_edit_outside_grid");
    const target = { sheet, cell: toA1Address(edit.row, edit.column) };
    if (edit.writeValue && edit.value === null && edit.formula === undefined && edit.style === undefined && !edit.styleReset) return { op: "clear_cell", target };
    const attributes: NonNullable<CellOperation["attributes"]> = {
      ...(edit.writeValue ? edit.formula === undefined ? { value: edit.value } : { formula: edit.formula } : {}),
      ...(edit.styleReset === undefined ? {} : { styleReset: edit.styleReset }),
    };
    return {
      op: "set_cell",
      target,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      ...(edit.style === undefined ? {} : { style: structuredClone(edit.style) }),
    };
  });
}
