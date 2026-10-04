/**
 * Tables panel model (B2ui, UNI-927) - the pure half of the Tables tab.
 *
 * Everything here is data or a pure function, so the panel stays presentational
 * and the contract the serialized UI-wire round binds is testable without React.
 *
 * Binding contract (committed B2e engine half,
 * `packages/office-engine/src/pptx/edits/table-edits.ts`): this panel emits
 * exactly that module's `TableEdit` union, so the wire round is mechanical -
 * `model.applyEdit(edit)` with no translation layer in between:
 *   add_table              -> { op: "add_table", slideIndex, rows, cols, xPx, yPx, wPx, hPx }
 *   set_table_cell         -> { op: "set_table_cell", slideIndex, elementId, row, col, paragraphs }
 *   table_merge            -> { op: "table_merge", slideIndex, elementId, kind, row, col }
 *   table_structure        -> { op: "table_structure", slideIndex, elementId, kind, index, before? }
 *   set_table_row_height   -> { op: "set_table_row_height", slideIndex, elementId, row, hPx }
 *   set_table_col_width    -> { op: "set_table_col_width", slideIndex, elementId, col, wPx }
 *   set_table_cell_anchor  -> { op: "set_table_cell_anchor", slideIndex, elementId, row, col, anchor }
 *   set_table_style        -> { op: "set_table_style", slideIndex, elementId, styleName | flags }
 *
 * Geometry is CSS pixels at the render viewport (the engine builder converts
 * each value with `makePxToEmu`), exactly like the Insert panel's px boxes.
 *
 * Refusals mirror the engine builder's own guard so the panel can explain a
 * refusal BEFORE an edit reaches the session: the same stable codes
 * (`bad_table_size`, `bad_table_rect`, `bad_table_cell`, `bad_table_merge`,
 * `bad_table_structure`, `bad_table_style`, `no_slide`, `no_element`) and the
 * same message shape a `PptxEngineError` carries. `PptxTableValidation<T>` is
 * that refusal shape; `validateInsertTable` / `validateTableTarget` are the two
 * entry points the panel uses.
 */
import {
  TABLE_STYLE_PRESET_NAMES,
  type PptxParagraphLike,
  type TableCellAnchor,
  type TableEdit,
  type TableMergeKind,
  type TableStructureKind,
  type TableStylePresetName,
} from "@uniwork/office-engine/pptx";

/** Bounds the Insert section offers; the engine only requires rows/cols >= 1. */
export const PPTX_TABLE_SIZE_MIN = 1;
export const PPTX_TABLE_SIZE_MAX = 20;

/** Default frame for an inserted table, in viewport px (Insert panel's rule). */
export const PPTX_TABLE_DEFAULT_BOX = { xPx: 100, yPx: 100, wPx: 480, hPx: 200 } as const;

export const PPTX_TABLE_MERGE_KINDS: readonly TableMergeKind[] = ["merge-right", "merge-down", "split"];
export const PPTX_TABLE_STRUCTURE_KINDS: readonly TableStructureKind[] = [
  "insert-row",
  "delete-row",
  "insert-col",
  "delete-col",
];
export const PPTX_TABLE_ANCHORS: readonly TableCellAnchor[] = ["top", "middle", "bottom"];

/** The seven region flags `setTableStyle` accepts beside a preset/styleId. */
export const PPTX_TABLE_STYLE_FLAGS = [
  "firstRow",
  "lastRow",
  "firstCol",
  "lastCol",
  "bandRow",
  "bandCol",
  "rtl",
] as const;
export type PptxTableStyleFlag = (typeof PPTX_TABLE_STYLE_FLAGS)[number];

/** One style preset the gallery renders; `nameKey` is its office.pptx.tables.* key. */
export interface PptxTableStylePreset {
  id: TableStylePresetName;
  nameKey: string;
}

/** The eight engine presets, in the vendored TABLE_STYLE_PRESETS order. */
export const PPTX_TABLE_STYLE_PRESETS: readonly PptxTableStylePreset[] = TABLE_STYLE_PRESET_NAMES.map((id) => ({
  id,
  nameKey: "office.pptx.tables.style.preset." + id,
}));

/** One target table: 0-based slide plus the element id the engine resolves. */
export interface PptxTableTarget {
  slideIndex: number;
  elementId: string;
}

/** One cell reference inside a table. */
export interface PptxTableCellRef {
  row: number;
  col: number;
}

/** The engine builder's refusal codes this model can produce. */
export type PptxTableRefusalCode =
  | "no_slide"
  | "no_element"
  | "bad_table_size"
  | "bad_table_rect"
  | "bad_table_cell"
  | "bad_table_merge"
  | "bad_table_structure"
  | "bad_table_style";

/** A refusal in the shape a `PptxEngineError` carries (code + message). */
export interface PptxTableRefusal {
  code: PptxTableRefusalCode;
  message: string;
}

/** Result of a validated build: the edit, or the engine's refusal shape. */
export type PptxTableValidation<T> = { ok: true; value: T } | ({ ok: false } & PptxTableRefusal);

const refuse = <T>(code: PptxTableRefusalCode, message: string): PptxTableValidation<T> => ({ ok: false, code, message });

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isFiniteNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** `rows`/`cols` for the insert op: an integer inside the panel's bounds. */
export function validateTableSize(rows: unknown, cols: unknown): PptxTableValidation<{ rows: number; cols: number }> {
  for (const [field, value] of [["rows", rows], ["cols", cols]] as const) {
    if (!isInt(value) || value < PPTX_TABLE_SIZE_MIN || value > PPTX_TABLE_SIZE_MAX) {
      return refuse(
        "bad_table_size",
        field + " must be an integer " + PPTX_TABLE_SIZE_MIN + ".." + PPTX_TABLE_SIZE_MAX,
      );
    }
  }
  return { ok: true, value: { rows: rows as number, cols: cols as number } };
}

/** A table target: a real slide index plus a non-empty element id. */
export function validateTableTarget(target: Partial<PptxTableTarget> | null | undefined): PptxTableValidation<PptxTableTarget> {
  if (!target || !isInt(target.slideIndex) || (target.slideIndex as number) < 0) {
    return refuse("no_slide", "a table target needs a slide index >= 0");
  }
  if (typeof target.elementId !== "string" || target.elementId.length === 0) {
    return refuse("no_element", "a table target needs an element id");
  }
  return { ok: true, value: { slideIndex: target.slideIndex as number, elementId: target.elementId } };
}

/** A cell reference: integer row/col >= 0. */
export function validateCellRef(row: unknown, col: unknown, code: PptxTableRefusalCode = "bad_table_cell"): PptxTableValidation<PptxTableCellRef> {
  if (!isInt(row) || row < 0) return refuse(code, "row must be an integer >= 0");
  if (!isInt(col) || col < 0) return refuse(code, "col must be an integer >= 0");
  return { ok: true, value: { row: row as number, col: col as number } };
}

/** A row height / column width in viewport px: a positive finite number. */
export function validateLengthPx(value: unknown, field: string): PptxTableValidation<number> {
  if (!isFiniteNum(value) || (value as number) <= 0) return refuse("bad_table_rect", field + " must be a positive number");
  return { ok: true, value: value as number };
}

/** Typed cell text -> the engine's paragraph shape: one run per line. */
export function cellParagraphs(text: string): PptxParagraphLike[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => ({ runs: [{ text: line }] }));
}

/** The refusal for a section whose target is missing, with the panel's own key. */
export function missingTargetRefusal(hasTable: boolean, hasCell: boolean): PptxTableRefusal | null {
  if (!hasTable) return { code: "no_element", message: "no table element is selected" };
  if (!hasCell) return { code: "bad_table_cell", message: "no cell is selected" };
  return null;
}

// ── edit builders (one engine union member each) ──────────────────────────

/** `add_table` for the Insert section; the engine converts the px box to EMU. */
export function buildInsertTableEdit(
  slideIndex: number,
  rows: number,
  cols: number,
  box: { xPx: number; yPx: number; wPx: number; hPx: number } = PPTX_TABLE_DEFAULT_BOX,
): PptxTableValidation<TableEdit> {
  if (!isInt(slideIndex) || slideIndex < 0) return refuse("no_slide", "a table needs a slide index >= 0");
  const size = validateTableSize(rows, cols);
  if (!size.ok) return size;
  return { ok: true, value: { op: "add_table", slideIndex, rows: size.value.rows, cols: size.value.cols, ...box } };
}

/** `set_table_cell`: the selected cell's new text, one paragraph per line. */
export function buildCellTextEdit(
  target: PptxTableTarget,
  row: number,
  col: number,
  text: string,
): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  const cell = validateCellRef(row, col);
  if (!cell.ok) return cell;
  return {
    ok: true,
    value: {
      op: "set_table_cell",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      row: cell.value.row,
      col: cell.value.col,
      paragraphs: cellParagraphs(text),
    },
  };
}

/** `table_merge`: merge right / merge down / split at the selected cell. */
export function buildMergeEdit(
  target: PptxTableTarget,
  kind: TableMergeKind,
  row: number,
  col: number,
): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  if (!(PPTX_TABLE_MERGE_KINDS as readonly string[]).includes(kind)) {
    return refuse("bad_table_merge", "unknown merge kind " + String(kind));
  }
  const cell = validateCellRef(row, col, "bad_table_merge");
  if (!cell.ok) return cell;
  return {
    ok: true,
    value: {
      op: "table_merge",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      kind,
      row: cell.value.row,
      col: cell.value.col,
    },
  };
}

/** `table_structure`: add/remove a row or column at `index` (`before` for inserts). */
export function buildStructureEdit(
  target: PptxTableTarget,
  kind: TableStructureKind,
  index: number,
  before = false,
): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  if (!(PPTX_TABLE_STRUCTURE_KINDS as readonly string[]).includes(kind)) {
    return refuse("bad_table_structure", "unknown structure kind " + String(kind));
  }
  if (!isInt(index) || index < 0) return refuse("bad_table_structure", "index must be an integer >= 0");
  return {
    ok: true,
    value: {
      op: "table_structure",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      kind,
      index,
      ...(before ? { before: true } : {}),
    },
  };
}

/** `set_table_row_height` in viewport px (the engine converts to EMU). */
export function buildRowHeightEdit(target: PptxTableTarget, row: number, hPx: number): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  const cell = validateCellRef(row, 0);
  if (!cell.ok) return cell;
  const height = validateLengthPx(hPx, "hPx");
  if (!height.ok) return height;
  return {
    ok: true,
    value: {
      op: "set_table_row_height",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      row: cell.value.row,
      hPx: height.value,
    },
  };
}

/** `set_table_col_width` in viewport px (the engine converts to EMU). */
export function buildColWidthEdit(target: PptxTableTarget, col: number, wPx: number): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  const cell = validateCellRef(0, col);
  if (!cell.ok) return cell;
  const width = validateLengthPx(wPx, "wPx");
  if (!width.ok) return width;
  return {
    ok: true,
    value: {
      op: "set_table_col_width",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      col: cell.value.col,
      wPx: width.value,
    },
  };
}

/** `set_table_cell_anchor`: vertical alignment of the selected cell. */
export function buildCellAnchorEdit(
  target: PptxTableTarget,
  row: number,
  col: number,
  anchor: TableCellAnchor,
): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  if (!(PPTX_TABLE_ANCHORS as readonly string[]).includes(anchor)) {
    return refuse("bad_table_cell", "unknown anchor " + String(anchor));
  }
  const cell = validateCellRef(row, col);
  if (!cell.ok) return cell;
  return {
    ok: true,
    value: {
      op: "set_table_cell_anchor",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      row: cell.value.row,
      col: cell.value.col,
      anchor,
    },
  };
}

/** `set_table_style` from a preset; a preset wins over every other style field. */
export function buildStylePresetEdit(target: PptxTableTarget, styleName: TableStylePresetName): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  if (!(TABLE_STYLE_PRESET_NAMES as readonly string[]).includes(styleName)) {
    return refuse("bad_table_style", "unknown style preset " + String(styleName));
  }
  return {
    ok: true,
    value: {
      op: "set_table_style",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      styleName,
    },
  };
}

/** `set_table_style` from region flags alone (no preset, no styleId). */
export function buildStyleFlagsEdit(
  target: PptxTableTarget,
  flags: Partial<Record<PptxTableStyleFlag, boolean>>,
): PptxTableValidation<TableEdit> {
  const resolved = validateTableTarget(target);
  if (!resolved.ok) return resolved;
  const set: Partial<Record<PptxTableStyleFlag, boolean>> = {};
  for (const flag of PPTX_TABLE_STYLE_FLAGS) {
    if (flags[flag] !== undefined) set[flag] = flags[flag] === true;
  }
  if (Object.keys(set).length === 0) {
    return refuse("bad_table_style", "a style edit needs a preset or at least one region flag");
  }
  return {
    ok: true,
    value: {
      op: "set_table_style",
      slideIndex: resolved.value.slideIndex,
      elementId: resolved.value.elementId,
      ...set,
    },
  };
}