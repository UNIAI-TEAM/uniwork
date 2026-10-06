import { describe, expect, it } from "vitest";
import { TABLE_STYLE_PRESET_NAMES, type TableEdit } from "@uniwork/office-engine/pptx";
import {
  PPTX_TABLE_ANCHORS,
  PPTX_TABLE_DEFAULT_BOX,
  PPTX_TABLE_MERGE_KINDS,
  PPTX_TABLE_SIZE_MAX,
  PPTX_TABLE_STYLE_PRESETS,
  PPTX_TABLE_STRUCTURE_KINDS,
  buildCellAnchorEdit,
  buildCellTextEdit,
  buildColWidthEdit,
  buildInsertTableEdit,
  buildMergeEdit,
  buildRowHeightEdit,
  buildStructureEdit,
  buildStyleFlagsEdit,
  buildStylePresetEdit,
  cellParagraphs,
  missingTargetRefusal,
  validateCellRef,
  validateLengthPx,
  validateTableSize,
  validateTableTarget,
} from "./table-model";

const target = { slideIndex: 1, elementId: "tbl1" } as const;
const value = <T>(result: { ok: true; value: T } | { ok: false; code: string }) => {
  if (!result.ok) throw new Error("expected ok, got " + result.code);
  return result.value;
};
const codeOf = (result: { ok: true } | { ok: false; code: string }) => (result.ok ? "" : result.code);

describe("preset data", () => {
  it("renders the engine's eight presets in the vendored order", () => {
    expect(PPTX_TABLE_STYLE_PRESETS.map((preset) => preset.id)).toEqual([...TABLE_STYLE_PRESET_NAMES]);
    for (const preset of PPTX_TABLE_STYLE_PRESETS) {
      expect(preset.nameKey).toBe("office.pptx.tables.style.preset." + preset.id);
    }
  });

  it("offers the engine's merge/structure/anchor vocabularies", () => {
    expect(PPTX_TABLE_MERGE_KINDS).toEqual(["merge-right", "merge-down", "split"]);
    expect(PPTX_TABLE_STRUCTURE_KINDS).toEqual(["insert-row", "delete-row", "insert-col", "delete-col"]);
    expect(PPTX_TABLE_ANCHORS).toEqual(["top", "middle", "bottom"]);
    expect(PPTX_TABLE_SIZE_MAX).toBeGreaterThan(1);
  });
});

describe("validation", () => {
  it("accepts a size inside the bounds and refuses the rest", () => {
    expect(value(validateTableSize(3, 4))).toEqual({ rows: 3, cols: 4 });
    expect(codeOf(validateTableSize(0, 3))).toBe("bad_table_size");
    expect(codeOf(validateTableSize(3, 1.5))).toBe("bad_table_size");
    expect(codeOf(validateTableSize(PPTX_TABLE_SIZE_MAX + 1, 1))).toBe("bad_table_size");
  });

  it("refuses a missing slide or element with the engine's codes", () => {
    expect(codeOf(validateTableTarget({ elementId: "t" }))).toBe("no_slide");
    expect(codeOf(validateTableTarget({ slideIndex: -1, elementId: "t" }))).toBe("no_slide");
    expect(codeOf(validateTableTarget({ slideIndex: 0 }))).toBe("no_element");
    expect(value(validateTableTarget(target))).toEqual(target);
  });

  it("refuses a non-integer cell reference", () => {
    expect(codeOf(validateCellRef(-1, 0))).toBe("bad_table_cell");
    expect(codeOf(validateCellRef(0, 1.2))).toBe("bad_table_cell");
    expect(value(validateCellRef(2, 3))).toEqual({ row: 2, col: 3 });
  });

  it("refuses a non-positive size in px", () => {
    expect(codeOf(validateLengthPx(0, "hPx"))).toBe("bad_table_rect");
    expect(codeOf(validateLengthPx(Number.NaN, "wPx"))).toBe("bad_table_rect");
    expect(value(validateLengthPx(40, "hPx"))).toBe(40);
  });

  it("names the missing target for the panel", () => {
    expect(missingTargetRefusal(false, false)?.code).toBe("no_element");
    expect(missingTargetRefusal(true, false)?.code).toBe("bad_table_cell");
    expect(missingTargetRefusal(true, true)).toBeNull();
  });
});

describe("cellParagraphs", () => {
  it("splits lines into one run each and normalizes CRLF", () => {
    expect(cellParagraphs("a\r\nb")).toEqual([{ runs: [{ text: "a" }] }, { runs: [{ text: "b" }] }]);
    expect(cellParagraphs("")).toEqual([{ runs: [{ text: "" }] }]);
  });
});

describe("edit builders", () => {
  it("builds add_table with the default box in px", () => {
    expect(value(buildInsertTableEdit(0, 2, 3))).toEqual({
      op: "add_table",
      slideIndex: 0,
      rows: 2,
      cols: 3,
      ...PPTX_TABLE_DEFAULT_BOX,
    });
    expect(codeOf(buildInsertTableEdit(-1, 2, 3))).toBe("no_slide");
    expect(codeOf(buildInsertTableEdit(0, 0, 3))).toBe("bad_table_size");
  });

  it("builds set_table_cell from typed text", () => {
    expect(value(buildCellTextEdit(target, 1, 2, "hi"))).toEqual({
      op: "set_table_cell",
      slideIndex: 1,
      elementId: "tbl1",
      row: 1,
      col: 2,
      paragraphs: [{ runs: [{ text: "hi" }] }],
    });
    expect(codeOf(buildCellTextEdit(target, -1, 0, "x"))).toBe("bad_table_cell");
  });

  it("builds table_merge for each kind and refuses an unknown one", () => {
    for (const kind of PPTX_TABLE_MERGE_KINDS) {
      expect(value(buildMergeEdit(target, kind, 0, 0))).toMatchObject({ op: "table_merge", kind, row: 0, col: 0 });
    }
    expect(codeOf(buildMergeEdit(target, "merge-left" as never, 0, 0))).toBe("bad_table_merge");
  });

  it("builds table_structure with before only for inserts", () => {
    expect(value(buildStructureEdit(target, "insert-row", 2, true))).toEqual({
      op: "table_structure",
      slideIndex: 1,
      elementId: "tbl1",
      kind: "insert-row",
      index: 2,
      before: true,
    });
    const del = value(buildStructureEdit(target, "delete-col", 1));
    expect(del).toEqual({ op: "table_structure", slideIndex: 1, elementId: "tbl1", kind: "delete-col", index: 1 });
    expect(Object.keys(del as Record<string, unknown>)).not.toContain("before");
    expect(codeOf(buildStructureEdit(target, "insert-rowz" as never, 0))).toBe("bad_table_structure");
  });

  it("builds row height and column width in px", () => {
    expect(value(buildRowHeightEdit(target, 3, 40))).toMatchObject({ op: "set_table_row_height", row: 3, hPx: 40 });
    expect(value(buildColWidthEdit(target, 2, 120))).toMatchObject({ op: "set_table_col_width", col: 2, wPx: 120 });
    expect(codeOf(buildRowHeightEdit(target, 0, 0))).toBe("bad_table_rect");
    expect(codeOf(buildColWidthEdit(target, 0, -1))).toBe("bad_table_rect");
  });

  it("builds set_table_cell_anchor for each anchor", () => {
    for (const anchor of PPTX_TABLE_ANCHORS) {
      expect(value(buildCellAnchorEdit(target, 0, 1, anchor))).toMatchObject({ op: "set_table_cell_anchor", anchor });
    }
    expect(codeOf(buildCellAnchorEdit(target, 0, 0, "center" as never))).toBe("bad_table_cell");
  });

  it("builds set_table_style from a preset", () => {
    expect(value(buildStylePresetEdit(target, "zebraBlue"))).toEqual({
      op: "set_table_style",
      slideIndex: 1,
      elementId: "tbl1",
      styleName: "zebraBlue",
    });
    expect(codeOf(buildStylePresetEdit(target, "fancy" as never))).toBe("bad_table_style");
  });

  it("builds set_table_style from flags and refuses an empty flag set", () => {
    expect(value(buildStyleFlagsEdit(target, { firstRow: true, bandRow: false }))).toEqual({
      op: "set_table_style",
      slideIndex: 1,
      elementId: "tbl1",
      firstRow: true,
      bandRow: false,
    });
    expect(codeOf(buildStyleFlagsEdit(target, {}))).toBe("bad_table_style");
  });

  it("every emitted edit is a real TableEdit union member", () => {
    const edits: TableEdit[] = [
      value(buildInsertTableEdit(0, 2, 2)),
      value(buildCellTextEdit(target, 0, 0, "x")),
      value(buildMergeEdit(target, "split", 0, 0)),
      value(buildStructureEdit(target, "insert-col", 0)),
      value(buildRowHeightEdit(target, 0, 30)),
      value(buildColWidthEdit(target, 0, 60)),
      value(buildCellAnchorEdit(target, 0, 0, "middle")),
      value(buildStylePresetEdit(target, "none")),
      value(buildStyleFlagsEdit(target, { rtl: true })),
    ];
    expect(edits.map((edit) => edit.op)).toEqual([
      "add_table",
      "set_table_cell",
      "table_merge",
      "table_structure",
      "set_table_row_height",
      "set_table_col_width",
      "set_table_cell_anchor",
      "set_table_style",
      "set_table_style",
    ]);
  });
});