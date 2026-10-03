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

/** One row/column journal op the renderer's structural journal emits (the
 *  vendored StructuralJournalOp subset this lane binds — no move-rows, no
 *  merges, no set-col-style). Positions are 0-based; row sizes are points,
 *  column sizes character width; null size = the sheet default. */
export type XlsxStructuralJournalOp =
  | { kind: "insert-rows" | "remove-rows" | "insert-cols" | "remove-cols"; index: number; count: number }
  | { kind: "set-row-size" | "set-col-size"; start: number; end: number; size: number | null }
  | { kind: "set-rows-hidden" | "set-cols-hidden"; start: number; end: number; hidden: boolean }
  | { kind: "set-rows-outline" | "set-cols-outline"; start: number; end: number; level: number; collapsed?: boolean };

/** The structural member of the renderer edit channel: a journal op plus the
 *  grid sheet id the envelope target resolves through. */
export interface XlsxGridStructuralEdit {
  sheetId: string;
  structural: XlsxStructuralJournalOp;
}

/** Every edit the streamed grid can emit: a cell edit or a structural op. */
export type XlsxGridEdit = XlsxGridCellEdit | XlsxGridStructuralEdit;

export function isStructuralGridEdit(edit: XlsxGridEdit): edit is XlsxGridStructuralEdit {
  return "structural" in edit;
}

/** The envelope target a cell operation addresses: the sheet name (not the
 *  grid's sheet id) and an A1 address. */
export interface XlsxCellOperationTarget {
  sheet: string;
  cell: string;
}

/** A structural envelope item addresses only its sheet; its fields ride the
 *  raw `attributes` object (the shared Go edit envelope needs no schema
 *  change). */
export interface XlsxStructuralOperationTarget {
  sheet: string;
}

/** The G2 cell-edit vocabulary: set_cell carries content/style, clear_cell
 *  removes the stored cell. */
export interface CellOperation {
  op: "set_cell" | "clear_cell";
  target: XlsxCellOperationTarget;
  attributes?: { value?: XlsxGridCellEdit["value"]; formula?: string; styleReset?: boolean };
  style?: Record<string, unknown>;
}

/** The row/column structural vocabulary; each kind maps 1:1 to an engine op
 *  kind (ops.ts) and the upstream StructuralOp the gateway consumes. */
export type StructuralOperation =
  | {
      op: "insert_rows" | "remove_rows" | "insert_cols" | "remove_cols";
      target: XlsxStructuralOperationTarget;
      attributes: { index: number; count: number };
    }
  | {
      op: "set_row_size" | "set_col_size";
      target: XlsxStructuralOperationTarget;
      attributes: { start: number; end: number; size: number | null };
    }
  | {
      op: "set_rows_hidden" | "set_cols_hidden";
      target: XlsxStructuralOperationTarget;
      attributes: { start: number; end: number; hidden: boolean };
    }
  | {
      op: "set_rows_outline" | "set_cols_outline";
      target: XlsxStructuralOperationTarget;
      attributes: { start: number; end: number; level: number; collapsed?: boolean };
    };

/** Every envelope operation a journal edit maps to. A later op kind adds its
 *  union member here and one XLSX_JOURNAL_OP_MAPPINGS entry —
 *  rendererEditsToOperations itself does not change. */
export type XlsxJournalOperation = CellOperation | StructuralOperation;

/** One named journal-edit → op-kind mapping. Entries are tested in table
 *  order and the first match wins, so the structural entries sit before the
 *  terminal set_cell fallback and every mapping stays kind-explicit. */
export interface XlsxJournalOpMapping {
  readonly op: XlsxJournalOperation["op"];
  matches(edit: XlsxGridEdit): boolean;
  build(edit: XlsxGridEdit, sheetName: string): XlsxJournalOperation;
}

/** A clear is a writeValue edit with no content and no style — the one shape
 *  that must not be written as an empty set_cell. */
function isClearEdit(edit: XlsxGridEdit): boolean {
  return !isStructuralGridEdit(edit) && edit.writeValue && edit.value === null && edit.formula === undefined && edit.style === undefined && !edit.styleReset;
}

const STRUCTURAL_WIRE_OP = {
  "insert-rows": "insert_rows",
  "remove-rows": "remove_rows",
  "insert-cols": "insert_cols",
  "remove-cols": "remove_cols",
  "set-row-size": "set_row_size",
  "set-col-size": "set_col_size",
  "set-rows-hidden": "set_rows_hidden",
  "set-cols-hidden": "set_cols_hidden",
  "set-rows-outline": "set_rows_outline",
  "set-cols-outline": "set_cols_outline",
} as const satisfies Record<XlsxStructuralJournalOp["kind"], StructuralOperation["op"]>;

function structuralOperation(
  structural: XlsxStructuralJournalOp,
  sheet: string,
): StructuralOperation {
  const target = { sheet };
  switch (structural.kind) {
    case "insert-rows":
    case "remove-rows":
    case "insert-cols":
    case "remove-cols":
      return { op: STRUCTURAL_WIRE_OP[structural.kind], target, attributes: { index: structural.index, count: structural.count } };
    case "set-row-size":
    case "set-col-size":
      return { op: STRUCTURAL_WIRE_OP[structural.kind], target, attributes: { start: structural.start, end: structural.end, size: structural.size } };
    case "set-rows-hidden":
    case "set-cols-hidden":
      return { op: STRUCTURAL_WIRE_OP[structural.kind], target, attributes: { start: structural.start, end: structural.end, hidden: structural.hidden } };
    case "set-rows-outline":
    case "set-cols-outline":
      return {
        op: STRUCTURAL_WIRE_OP[structural.kind],
        target,
        attributes: {
          start: structural.start,
          end: structural.end,
          level: structural.level,
          ...(structural.collapsed === undefined ? {} : { collapsed: structural.collapsed }),
        },
      };
  }
}

function structuralMapping(
  op: StructuralOperation["op"],
  journalKind: XlsxStructuralJournalOp["kind"],
): XlsxJournalOpMapping {
  return {
    op,
    matches: (edit) => isStructuralGridEdit(edit) && edit.structural.kind === journalKind,
    build: (edit, sheet) => structuralOperation((edit as XlsxGridStructuralEdit).structural, sheet),
  };
}

/** Journal-edit → op-kind table, in match order. */
export const XLSX_JOURNAL_OP_MAPPINGS: readonly XlsxJournalOpMapping[] = [
  {
    op: "clear_cell",
    matches: isClearEdit,
    build: (_edit, sheet) => {
      const edit = _edit as XlsxGridCellEdit;
      return { op: "clear_cell", target: { sheet, cell: toA1Address(edit.row, edit.column) } };
    },
  },
  {
    op: "set_cell",
    matches: (edit) => !isStructuralGridEdit(edit),
    build: (edit, sheet) => {
      const cell = edit as XlsxGridCellEdit;
      const attributes: NonNullable<CellOperation["attributes"]> = {
        ...(cell.writeValue ? cell.formula === undefined ? { value: cell.value } : { formula: cell.formula } : {}),
        ...(cell.styleReset === undefined ? {} : { styleReset: cell.styleReset }),
      };
      return {
        op: "set_cell",
        target: { sheet, cell: toA1Address(cell.row, cell.column) },
        ...(Object.keys(attributes).length ? { attributes } : {}),
        ...(cell.style === undefined ? {} : { style: structuredClone(cell.style) }),
      };
    },
  },
  structuralMapping("insert_rows", "insert-rows"),
  structuralMapping("remove_rows", "remove-rows"),
  structuralMapping("insert_cols", "insert-cols"),
  structuralMapping("remove_cols", "remove-cols"),
  structuralMapping("set_row_size", "set-row-size"),
  structuralMapping("set_col_size", "set-col-size"),
  structuralMapping("set_rows_hidden", "set-rows-hidden"),
  structuralMapping("set_cols_hidden", "set-cols-hidden"),
  structuralMapping("set_rows_outline", "set-rows-outline"),
  structuralMapping("set_cols_outline", "set-cols-outline"),
];

/** Keep the G2 vocabulary: a style-only edit must never overwrite a value. */
export function rendererEditsToOperations(
  sheets: readonly { id: string; name: string }[],
  edits: readonly XlsxGridEdit[],
): XlsxJournalOperation[] {
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  return edits.map((edit) => {
    const sheet = names.get(edit.sheetId);
    if (!sheet) throw new Error("xlsx_edit_unknown_sheet");
    if (!isStructuralGridEdit(edit) && (!Number.isSafeInteger(edit.row) || !Number.isSafeInteger(edit.column) || edit.row < 0 || edit.row >= 1_048_576 || edit.column < 0 || edit.column >= 16_384)) throw new Error("xlsx_edit_outside_grid");
    const mapping = XLSX_JOURNAL_OP_MAPPINGS.find((entry) => entry.matches(edit));
    if (!mapping) throw new Error("xlsx_edit_unmapped");
    return mapping.build(edit, sheet);
  });
}
