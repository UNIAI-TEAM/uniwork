import { toA1Address } from "./xlsx-render-model-bridge";

/** Serializable user edits emitted by the streamed grid, including undo.
 *  `sheetName` is the sheet's CURRENT name captured live from the mounted
 *  workbook (a session rename changes it), so an edit that follows a rename
 *  addresses the renamed sheet; when absent the bridge falls back to the
 *  host file's name for the grid id. */
export interface XlsxGridCellEdit {
  sheetId: string;
  sheetName?: string;
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
 *  set-col-style). Positions are 0-based; row sizes are points, column sizes
 *  character width; null size = the sheet default. Merge ops carry their
 *  0-based rectangle; they never shift coordinates. */
export type XlsxStructuralJournalOp =
  | { kind: "insert-rows" | "remove-rows" | "insert-cols" | "remove-cols"; index: number; count: number }
  | { kind: "set-row-size" | "set-col-size"; start: number; end: number; size: number | null }
  | { kind: "set-rows-hidden" | "set-cols-hidden"; start: number; end: number; hidden: boolean }
  | { kind: "set-rows-outline" | "set-cols-outline"; start: number; end: number; level: number; collapsed?: boolean }
  | { kind: "merge-cells" | "unmerge-cells"; range: XlsxStructuralJournalRange };

/** A 0-based inclusive rectangle — the merge range the journal records. */
export interface XlsxStructuralJournalRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

/** The structural member of the renderer edit channel: a journal op plus the
 *  grid sheet id the envelope target resolves through. `sheetName` is the live
 *  name at emission (see XlsxGridCellEdit). */
export interface XlsxGridStructuralEdit {
  sheetId: string;
  sheetName?: string;
  structural: XlsxStructuralJournalOp;
}

/** One worksheet-level edit (B3) the renderer emits: the op plus the live name
 *  it addresses. Per kind:
 *   - `add-sheet` / `duplicate-sheet`: `sheetName` is the NEW sheet's name,
 *     `index` its final tab position (duplicate also names its source);
 *   - `remove-sheet`: `sheetName` is the removed sheet's name;
 *   - `rename-sheet`: `sheetName` is the OLD name, `newName` the new one (the
 *     wire needs both — the target resolves against the pre-mutation name);
 *   - `reorder-sheet` / `set-sheet-hidden`: `sheetName` is unchanged. */
export interface XlsxGridSheetEdit {
  sheetId: string;
  sheetName: string;
  sheetOp: XlsxSheetJournalOp;
}

export type XlsxSheetJournalOp =
  | { kind: "add-sheet"; index: number }
  | { kind: "duplicate-sheet"; sourceSheetId: string; sourceName: string; index: number }
  | { kind: "remove-sheet" }
  | { kind: "rename-sheet"; newName: string }
  | { kind: "set-sheet-hidden"; hidden: boolean }
  | { kind: "reorder-sheet"; index: number };

/** Every edit the streamed grid can emit: a cell edit, a structural op or a
 *  sheet op. */
export type XlsxGridEdit = XlsxGridCellEdit | XlsxGridStructuralEdit | XlsxGridSheetEdit;

export function isStructuralGridEdit(edit: XlsxGridEdit): edit is XlsxGridStructuralEdit {
  return "structural" in edit;
}

export function isSheetGridEdit(edit: XlsxGridEdit): edit is XlsxGridSheetEdit {
  return "sheetOp" in edit;
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
    }
  | {
      /** The merge rectangle rides the envelope's own `range` field, matching
       *  the engine parser and the upstream StructuralOp merge branch. */
      op: "merge_cells" | "unmerge_cells";
      target: XlsxStructuralOperationTarget;
      range: XlsxStructuralJournalRange;
    };

/** The worksheet-level vocabulary (B3); each kind maps 1:1 to an engine op
 *  kind (ops.ts) and the six ops fold into ONE gateway SheetEditPlan per save.
 *  `index` is a 0-based final tab position; `rename_sheet` names the sheet by
 *  its pre-mutation name (the wire target is resolved against the live
 *  resolver before the rename applies). */
export type SheetOperation =
  | {
      op: "add_sheet";
      attributes: { name: string; index: number };
    }
  | {
      op: "duplicate_sheet";
      target: XlsxStructuralOperationTarget;
      attributes: { name: string; index: number };
    }
  | {
      op: "remove_sheet";
      target: XlsxStructuralOperationTarget;
    }
  | {
      op: "rename_sheet";
      target: XlsxStructuralOperationTarget;
      attributes: { newName: string };
    }
  | {
      op: "reorder_sheet";
      target: XlsxStructuralOperationTarget;
      attributes: { index: number };
    }
  | {
      op: "set_sheet_hidden";
      target: XlsxStructuralOperationTarget;
      attributes: { hidden: boolean };
    };

/** Every envelope operation a journal edit maps to. A later op kind adds its
 *  union member here and one XLSX_JOURNAL_OP_MAPPINGS entry —
 *  rendererEditsToOperations itself does not change. */
export type XlsxJournalOperation = CellOperation | StructuralOperation | SheetOperation;

/** One named journal-edit → op-kind mapping. Entries are tested in table
 *  order and the first match wins; the structural entries are appended after
 *  the terminal set_cell fallback, which excludes structural edits, so every
 *  mapping stays kind-explicit. */
export interface XlsxJournalOpMapping {
  readonly op: XlsxJournalOperation["op"];
  matches(edit: XlsxGridEdit): boolean;
  build(edit: XlsxGridEdit, sheetName: string): XlsxJournalOperation;
}

/** A clear is a writeValue edit with no content and no style — the one shape
 *  that must not be written as an empty set_cell. */
function isClearEdit(edit: XlsxGridEdit): boolean {
  return !isStructuralGridEdit(edit) && !isSheetGridEdit(edit) && edit.writeValue && edit.value === null && edit.formula === undefined && edit.style === undefined && !edit.styleReset;
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
  "merge-cells": "merge_cells",
  "unmerge-cells": "unmerge_cells",
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
    case "merge-cells":
    case "unmerge-cells":
      return { op: STRUCTURAL_WIRE_OP[structural.kind], target, range: { ...structural.range } };
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

function sheetOperation(op: XlsxGridSheetEdit, sheet: string): SheetOperation {
  const target = { sheet };
  const add = op.sheetOp;
  switch (add.kind) {
    case "add-sheet":
      return { op: "add_sheet", attributes: { name: op.sheetName, index: add.index } };
    case "duplicate-sheet":
      return { op: "duplicate_sheet", target: { sheet: add.sourceName }, attributes: { name: op.sheetName, index: add.index } };
    case "remove-sheet":
      return { op: "remove_sheet", target };
    case "rename-sheet":
      return { op: "rename_sheet", target, attributes: { newName: add.newName } };
    case "reorder-sheet":
      return { op: "reorder_sheet", target, attributes: { index: add.index } };
    case "set-sheet-hidden":
      return { op: "set_sheet_hidden", target, attributes: { hidden: add.hidden } };
  }
}

function sheetMapping(
  op: SheetOperation["op"],
  journalKind: XlsxSheetJournalOp["kind"],
): XlsxJournalOpMapping {
  return {
    op,
    matches: (edit) => isSheetGridEdit(edit) && edit.sheetOp.kind === journalKind,
    // A sheet edit carries its own live name; the second argument is only a
    // fallback for edits that resolve through the host file's id map.
    build: (edit, sheet) => sheetOperation(edit as XlsxGridSheetEdit, (edit as XlsxGridSheetEdit).sheetName || sheet),
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
    matches: (edit) => !isStructuralGridEdit(edit) && !isSheetGridEdit(edit),
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
  structuralMapping("merge_cells", "merge-cells"),
  structuralMapping("unmerge_cells", "unmerge-cells"),
  sheetMapping("add_sheet", "add-sheet"),
  sheetMapping("duplicate_sheet", "duplicate-sheet"),
  sheetMapping("remove_sheet", "remove-sheet"),
  sheetMapping("rename_sheet", "rename-sheet"),
  sheetMapping("reorder_sheet", "reorder-sheet"),
  sheetMapping("set_sheet_hidden", "set-sheet-hidden"),
];

/** Keep the G2 vocabulary: a style-only edit must never overwrite a value.
 *  Sheet names resolve from the edit's own live name when it carries one
 *  (cell/structural edits annotate it, sheet edits always do); otherwise from
 *  the host file's id map. */
export function rendererEditsToOperations(
  sheets: readonly { id: string; name: string }[],
  edits: readonly XlsxGridEdit[],
): XlsxJournalOperation[] {
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  return edits.map((edit) => {
    const sheet = isSheetGridEdit(edit) ? edit.sheetName : edit.sheetName ?? names.get(edit.sheetId);
    if (!sheet) throw new Error("xlsx_edit_unknown_sheet");
    if (!isStructuralGridEdit(edit) && !isSheetGridEdit(edit) && (!Number.isSafeInteger(edit.row) || !Number.isSafeInteger(edit.column) || edit.row < 0 || edit.row >= 1_048_576 || edit.column < 0 || edit.column >= 16_384)) throw new Error("xlsx_edit_outside_grid");
    const mapping = XLSX_JOURNAL_OP_MAPPINGS.find((entry) => entry.matches(edit));
    if (!mapping) throw new Error("xlsx_edit_unmapped");
    return mapping.build(edit, sheet);
  });
}
