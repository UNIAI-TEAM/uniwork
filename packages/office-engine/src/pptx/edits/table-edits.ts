// PPTX table edit builder — the B2 engine half (UNI-927).
//
// One typed, validated TableEdit per table gesture; every gesture becomes
// exactly one vendored pptx-ops op the session model runs through its
// dry-run + atomic-apply txn(). The vendored registry is the contract for op
// names and fields (packages/office-upstream/upstream/packages/pptx-ops/src/ops):
//   addTable           insert-ops.ts:174
//   setTableCell       table-ops.ts:35
//   tableMerge         table-ops.ts:75
//   tableStructure     table-ops.ts:99
//   setTableRowHeight  table-ops.ts:123
//   setTableCellAnchor table-ops.ts:140
//   setTableColWidth   table-ops.ts:170
//   setTableStyle      table-ops.ts:296
//
// Pixel -> EMU mapping: edits carry CSS pixels at the render viewport
// (xPx/yPx/wPx/hPx, colWidthsPx/rowHeightsPx, hPx, wPx) and buildTableOps
// converts each value with makePxToEmu(opened, fitWidthPx) — the same scale
// the canvas uses (deck width at 96 DPI scaled to fitWidthPx). Ops carry EMU
// only (offset {x,y,cx,cy}, colWidthsEmu, rowHeightsEmu, hEmu, wEmu).
// Gestures with no geometry never touch the scale.
//
// Anchors: edits use top/middle/bottom (the setTableCellAnchor op vocabulary);
// add_table cellProps maps that to the engine's t/ctr/b tcPr anchor.
//
// tableMerge/tableStructure reparse the slide and regenerate element ids: the
// executor records the surviving id in the record's `after.elementId`, so the
// wire round/UI must keep selection from that record, never from the id the
// edit named.
import {
  PptxEngineError,
  type OpenedPptxLike,
  type PptxOp,
  type PptxParagraphLike,
} from "../engine";
import { makePxToEmu } from "../model";

export type TableCellAnchor = "top" | "middle" | "bottom";
export type TableMergeKind = "merge-right" | "merge-down" | "split";
export type TableStructureKind = "insert-row" | "delete-row" | "insert-col" | "delete-col";

/** Per-cell structural attributes for add_table, row-major; the engine sees t/ctr/b. */
export interface TableCellProps {
  gridSpan?: number;
  rowSpan?: number;
  hMerge?: boolean;
  vMerge?: boolean;
  anchor?: TableCellAnchor;
}

/** setTableStyle fields; styleName beats every other field (insert-ops-style precedence). */
export interface TableStyleEditFields {
  styleName?: TableStylePresetName;
  styleId?: string;
  firstRow?: boolean;
  lastRow?: boolean;
  firstCol?: boolean;
  lastCol?: boolean;
  bandRow?: boolean;
  bandCol?: boolean;
  rtl?: boolean;
  keepFormatting?: boolean;
  shadingColor?: string;
  borderColor?: string;
  borderWidthPt?: number;
  borderPreset?: "all" | "none";
  cells?: Array<{ row: number; col: number }>;
}

export type TableEdit =
  | { op: "add_table"; slideIndex: number; rows: number; cols: number; xPx: number; yPx: number; wPx: number; hPx: number; colWidthsPx?: number[]; rowHeightsPx?: number[]; cellProps?: Array<Array<TableCellProps | undefined>> }
  | { op: "set_table_cell"; slideIndex: number; elementId: string; row: number; col: number; paragraphs: PptxParagraphLike[] }
  | { op: "table_merge"; slideIndex: number; elementId: string; kind: TableMergeKind; row: number; col: number }
  | { op: "table_structure"; slideIndex: number; elementId: string; kind: TableStructureKind; index: number; before?: boolean }
  | { op: "set_table_row_height"; slideIndex: number; elementId: string; row: number; hPx: number }
  | { op: "set_table_col_width"; slideIndex: number; elementId: string; col: number; wPx: number }
  | { op: "set_table_cell_anchor"; slideIndex: number; elementId: string; row: number; col: number; anchor: TableCellAnchor }
  | ({ op: "set_table_style"; slideIndex: number; elementId: string } & TableStyleEditFields);

/** setTableStyle preset keys — pinned to the vendored TABLE_STYLE_PRESETS keys
 * (pptx-engine/src/table-edit.ts:111) by test/pptx-table-edits.test.ts; the UI
 * style gallery renders from this list. */
export const TABLE_STYLE_PRESET_NAMES = [
  "none",
  "lightGrid",
  "zebraBlue",
  "zebraGray",
  "headerDarkBlue",
  "headerOrange",
  "noBorder",
  "fullBorder",
] as const;
export type TableStylePresetName = (typeof TABLE_STYLE_PRESET_NAMES)[number];

/** Build the one vendored op an edit maps to; targets and fields are validated
 * here so the wire round stays a mechanical txn(buildTableOps(...)) call. */
export function buildTableOps(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: TableEdit,
): PptxOp[] {
  switch (edit.op) {
    case "add_table":
      return [buildAddTable(opened, fitWidthPx, edit)];
    case "set_table_cell":
      return [buildSetTableCell(opened, edit)];
    case "table_merge":
      return [buildTableMerge(opened, edit)];
    case "table_structure":
      return [buildTableStructure(opened, edit)];
    case "set_table_row_height":
      return [buildRowHeight(opened, fitWidthPx, edit)];
    case "set_table_col_width":
      return [buildColWidth(opened, fitWidthPx, edit)];
    case "set_table_cell_anchor":
      return [buildCellAnchor(opened, edit)];
    case "set_table_style":
      return [buildTableStyle(opened, edit)];
  }
}

// ── shared validation ───────────────────────────────────────────────────

function fail(code: string, message: string): never {
  throw new PptxEngineError(code, message);
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const requireIndex = (value: unknown, field: string, code: string): void => {
  if (!isInt(value) || value < 0) fail(code, field + " must be an integer >= 0");
};

const requireUnit = (value: unknown, field: string, code: string): void => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(code, field + " must be a finite number >= 0");
  }
};

const requirePositive = (value: unknown, field: string, code: string): void => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(code, field + " must be a positive finite number");
  }
};

const requireSlide = (opened: OpenedPptxLike, slideIndex: number): void => {
  if (!opened.deck.slides[slideIndex]) fail("no_slide", "no slide " + slideIndex);
};

const requireTable = (opened: OpenedPptxLike, slideIndex: number, elementId: string): void => {
  const slide = opened.deck.slides[slideIndex];
  if (!slide) fail("no_slide", "no slide " + slideIndex);
  const element = slide.elements.find((e) => e.id === elementId);
  if (!element || element.type !== "table") {
    fail("no_element", "no table element " + elementId + " on slide " + slideIndex);
  }
};

const ANCHORS: readonly string[] = ["top", "middle", "bottom"];
const ENGINE_ANCHOR: Record<TableCellAnchor, "t" | "ctr" | "b"> = {
  top: "t",
  middle: "ctr",
  bottom: "b",
};

const requireAnchor = (value: unknown, code: string): TableCellAnchor => {
  if (typeof value !== "string" || !ANCHORS.includes(value)) {
    fail(code, 'anchor must be "top", "middle" or "bottom"');
  }
  return value as TableCellAnchor;
};

const isPx = (value: number): boolean => typeof value === "number" && Number.isFinite(value);

const emuList = (
  values: number[],
  count: number,
  field: string,
  dim: string,
  toEmu: (px: number) => number,
): number[] => {
  if (!Array.isArray(values) || values.length !== count) {
    fail("bad_table_size", field + " must list exactly " + count + " values (one per " + dim + ")");
  }
  return values.map((value, i) => {
    requirePositive(value, field + "[" + i + "]", "bad_table_rect");
    return toEmu(value);
  });
};

interface EngineCellProps {
  gridSpan?: number;
  rowSpan?: number;
  hMerge?: boolean;
  vMerge?: boolean;
  anchor?: "t" | "ctr" | "b";
}

const mapCellProps = (
  cellProps: Array<Array<TableCellProps | undefined>>,
): Array<Array<EngineCellProps | undefined>> => {
  if (!Array.isArray(cellProps)) {
    fail("bad_table_cell", "cellProps must be a row-major array of per-cell props");
  }
  return cellProps.map((row, r) => {
    if (!Array.isArray(row)) {
      fail("bad_table_cell", "cellProps[" + r + "] must be an array of per-cell props");
    }
    return row.map((cell, c) => {
      if (cell == null) return undefined;
      if (typeof cell !== "object") {
        fail("bad_table_cell", "cellProps[" + r + "][" + c + "] must be an object");
      }
      const mapped: EngineCellProps = {};
      if (cell.gridSpan !== undefined) {
        if (!isInt(cell.gridSpan) || cell.gridSpan < 1) {
          fail("bad_table_cell", "cellProps[" + r + "][" + c + "].gridSpan must be an integer >= 1");
        }
        mapped.gridSpan = cell.gridSpan;
      }
      if (cell.rowSpan !== undefined) {
        if (!isInt(cell.rowSpan) || cell.rowSpan < 1) {
          fail("bad_table_cell", "cellProps[" + r + "][" + c + "].rowSpan must be an integer >= 1");
        }
        mapped.rowSpan = cell.rowSpan;
      }
      if (cell.hMerge !== undefined) {
        if (typeof cell.hMerge !== "boolean") {
          fail("bad_table_cell", "cellProps[" + r + "][" + c + "].hMerge must be a boolean");
        }
        mapped.hMerge = cell.hMerge;
      }
      if (cell.vMerge !== undefined) {
        if (typeof cell.vMerge !== "boolean") {
          fail("bad_table_cell", "cellProps[" + r + "][" + c + "].vMerge must be a boolean");
        }
        mapped.vMerge = cell.vMerge;
      }
      if (cell.anchor !== undefined) {
        mapped.anchor = ENGINE_ANCHOR[requireAnchor(cell.anchor, "bad_table_cell")];
      }
      return mapped;
    });
  });
};

// ── builders ────────────────────────────────────────────────────────────

function buildAddTable(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: Extract<TableEdit, { op: "add_table" }>,
): PptxOp {
  requireSlide(opened, edit.slideIndex);
  if (!isInt(edit.rows) || edit.rows < 1) fail("bad_table_size", "rows must be an integer >= 1");
  if (!isInt(edit.cols) || edit.cols < 1) fail("bad_table_size", "cols must be an integer >= 1");
  requireUnit(edit.xPx, "xPx", "bad_table_rect");
  requireUnit(edit.yPx, "yPx", "bad_table_rect");
  requirePositive(edit.wPx, "wPx", "bad_table_rect");
  requirePositive(edit.hPx, "hPx", "bad_table_rect");
  const toEmu = makePxToEmu(opened, fitWidthPx);
  const colWidthsEmu =
    edit.colWidthsPx !== undefined
      ? emuList(edit.colWidthsPx, edit.cols, "colWidthsPx", "column", toEmu)
      : undefined;
  const rowHeightsEmu =
    edit.rowHeightsPx !== undefined
      ? emuList(edit.rowHeightsPx, edit.rows, "rowHeightsPx", "row", toEmu)
      : undefined;
  return {
    op: "addTable",
    target: { slide: edit.slideIndex },
    rows: edit.rows,
    cols: edit.cols,
    offset: { x: toEmu(edit.xPx), y: toEmu(edit.yPx), cx: toEmu(edit.wPx), cy: toEmu(edit.hPx) },
    ...(colWidthsEmu ? { colWidthsEmu } : {}),
    ...(rowHeightsEmu ? { rowHeightsEmu } : {}),
    ...(edit.cellProps !== undefined ? { cellProps: mapCellProps(edit.cellProps) } : {}),
  };
}

function buildSetTableCell(
  opened: OpenedPptxLike,
  edit: Extract<TableEdit, { op: "set_table_cell" }>,
): PptxOp {
  requireTable(opened, edit.slideIndex, edit.elementId);
  requireIndex(edit.row, "row", "bad_table_cell");
  requireIndex(edit.col, "col", "bad_table_cell");
  // EditParagraph shapes pass through untouched — the wire round/UI owns the model.
  if (!Array.isArray(edit.paragraphs)) {
    fail("bad_table_cell", "paragraphs must be the cell's EditParagraph array");
  }
  return {
    op: "setTableCell",
    target: { slide: edit.slideIndex, el: edit.elementId },
    row: edit.row,
    col: edit.col,
    paragraphs: edit.paragraphs,
  };
}

const MERGE_KINDS: readonly string[] = ["merge-right", "merge-down", "split"];

function buildTableMerge(
  opened: OpenedPptxLike,
  edit: Extract<TableEdit, { op: "table_merge" }>,
): PptxOp {
  requireTable(opened, edit.slideIndex, edit.elementId);
  if (!MERGE_KINDS.includes(edit.kind)) {
    fail("bad_table_merge", 'kind must be "merge-right", "merge-down" or "split"');
  }
  requireIndex(edit.row, "row", "bad_table_merge");
  requireIndex(edit.col, "col", "bad_table_merge");
  return {
    op: "tableMerge",
    target: { slide: edit.slideIndex, el: edit.elementId },
    kind: edit.kind,
    row: edit.row,
    col: edit.col,
  };
}

const STRUCTURE_KINDS: readonly string[] = [
  "insert-row",
  "delete-row",
  "insert-col",
  "delete-col",
];

function buildTableStructure(
  opened: OpenedPptxLike,
  edit: Extract<TableEdit, { op: "table_structure" }>,
): PptxOp {
  requireTable(opened, edit.slideIndex, edit.elementId);
  if (!STRUCTURE_KINDS.includes(edit.kind)) {
    fail("bad_table_structure", 'kind must be "insert-row", "delete-row", "insert-col" or "delete-col"');
  }
  requireIndex(edit.index, "index", "bad_table_structure");
  return {
    op: "tableStructure",
    target: { slide: edit.slideIndex, el: edit.elementId },
    kind: edit.kind,
    index: edit.index,
    ...(edit.before ? { before: true } : {}),
  };
}

function buildRowHeight(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: Extract<TableEdit, { op: "set_table_row_height" }>,
): PptxOp {
  requireTable(opened, edit.slideIndex, edit.elementId);
  requireIndex(edit.row, "row", "bad_table_cell");
  requirePositive(edit.hPx, "hPx", "bad_table_rect");
  return {
    op: "setTableRowHeight",
    target: { slide: edit.slideIndex, el: edit.elementId },
    row: edit.row,
    hEmu: makePxToEmu(opened, fitWidthPx)(edit.hPx),
  };
}

function buildColWidth(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: Extract<TableEdit, { op: "set_table_col_width" }>,
): PptxOp {
  requireTable(opened, edit.slideIndex, edit.elementId);
  requireIndex(edit.col, "col", "bad_table_cell");
  requirePositive(edit.wPx, "wPx", "bad_table_rect");
  return {
    op: "setTableColWidth",
    target: { slide: edit.slideIndex, el: edit.elementId },
    col: edit.col,
    wEmu: makePxToEmu(opened, fitWidthPx)(edit.wPx),
  };
}

function buildCellAnchor(
  opened: OpenedPptxLike,
  edit: Extract<TableEdit, { op: "set_table_cell_anchor" }>,
): PptxOp {
  requireTable(opened, edit.slideIndex, edit.elementId);
  requireIndex(edit.row, "row", "bad_table_cell");
  requireIndex(edit.col, "col", "bad_table_cell");
  return {
    op: "setTableCellAnchor",
    target: { slide: edit.slideIndex, el: edit.elementId },
    row: edit.row,
    col: edit.col,
    anchor: requireAnchor(edit.anchor, "bad_table_cell"),
  };
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const STYLE_FLAG_FIELDS = ["firstRow", "lastRow", "firstCol", "lastCol", "bandRow", "bandCol", "rtl"] as const;

function buildTableStyle(
  opened: OpenedPptxLike,
  edit: Extract<TableEdit, { op: "set_table_style" }>,
): PptxOp {
  requireTable(opened, edit.slideIndex, edit.elementId);
  const target = { slide: edit.slideIndex, el: edit.elementId };
  if (edit.styleName !== undefined) {
    if (!(TABLE_STYLE_PRESET_NAMES as readonly string[]).includes(edit.styleName)) {
      fail(
        "bad_table_style",
        'unknown styleName "' + String(edit.styleName) + '"; presets: ' + TABLE_STYLE_PRESET_NAMES.join(", "),
      );
    }
    // A preset wins over every other field (table-ops.ts:214-253) and its fixed-color
    // definition clears direct cell formatting; keepFormatting only matters with styleId.
    return { op: "setTableStyle", target, styleName: edit.styleName };
  }
  let styleId: string | undefined;
  if (edit.styleId !== undefined) {
    if (typeof edit.styleId !== "string" || !edit.styleId.trim()) {
      fail("bad_table_style", "styleId must be a built-in style name or GUID");
    }
    styleId = edit.styleId.trim();
  }
  if (edit.shadingColor !== undefined && edit.shadingColor !== "none" && !HEX_COLOR.test(String(edit.shadingColor))) {
    fail("bad_table_style", 'shadingColor must be #RRGGBB or "none"');
  }
  if (edit.borderColor !== undefined && !HEX_COLOR.test(String(edit.borderColor))) {
    fail("bad_table_style", "borderColor must be #RRGGBB");
  }
  if (
    edit.borderWidthPt !== undefined &&
    (!isPx(edit.borderWidthPt) || edit.borderWidthPt <= 0)
  ) {
    fail("bad_table_style", "borderWidthPt must be a positive finite number");
  }
  if (edit.borderPreset !== undefined && edit.borderPreset !== "all" && edit.borderPreset !== "none") {
    fail("bad_table_style", 'borderPreset must be "all" or "none"');
  }
  if (edit.cells !== undefined) {
    if (!Array.isArray(edit.cells)) fail("bad_table_style", "cells must be an array of {row, col}");
    edit.cells.forEach((cell, i) => {
      if (!cell || typeof cell !== "object" || !isInt(cell.row) || cell.row < 0 || !isInt(cell.col) || cell.col < 0) {
        fail("bad_table_style", "cells[" + i + "] must be {row, col} with integer indexes >= 0");
      }
    });
  }
  const flags: Record<string, boolean> = {};
  for (const field of STYLE_FLAG_FIELDS) {
    const value = edit[field];
    if (value !== undefined) flags[field] = Boolean(value);
  }
  const hasField =
    styleId !== undefined ||
    Object.keys(flags).length > 0 ||
    edit.shadingColor !== undefined ||
    edit.borderColor !== undefined ||
    edit.borderWidthPt !== undefined ||
    edit.borderPreset !== undefined ||
    edit.cells !== undefined;
  if (!hasField) {
    fail("bad_table_style", "set_table_style needs styleName, styleId or at least one region/color/border/cells field");
  }
  return {
    op: "setTableStyle",
    target,
    ...(styleId !== undefined ? { styleId } : {}),
    ...(styleId !== undefined && edit.keepFormatting === true ? { keepFormatting: true } : {}),
    ...flags,
    ...(edit.shadingColor !== undefined ? { shadingColor: String(edit.shadingColor) } : {}),
    ...(edit.borderColor !== undefined ? { borderColor: String(edit.borderColor) } : {}),
    ...(edit.borderWidthPt !== undefined ? { borderWidthPt: edit.borderWidthPt } : {}),
    ...(edit.borderPreset !== undefined ? { borderPreset: edit.borderPreset } : {}),
    ...(edit.cells !== undefined ? { cells: edit.cells } : {}),
  };
}
