// B2 engine-half tests — vendored op-name guard, exact op objects (px→EMU),
// stable refusal codes, and the preset list pinned to the vendored engine.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildTableOps,
  EMU_PER_PX_96,
  TABLE_STYLE_PRESET_NAMES,
  type OpenedPptxLike,
  type PptxParagraphLike,
  type TableCellAnchor,
  type TableEdit,
  type TableMergeKind,
  type TableStylePresetName,
} from "../src/pptx";

const FIT = 960; // deck 9144000 EMU = 960px at 96 DPI → scale 1
const EMU = (px: number): number => px * EMU_PER_PX_96;

const opened = (): OpenedPptxLike => ({
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      {
        id: "s1",
        elements: [
          { id: "tbl1", type: "table" },
          { id: "txt1", type: "text", text: { paragraphs: [{ runs: [{ text: "x" }] }] } },
        ],
      },
    ],
  },
});

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const readVendored = (rel: string): string =>
  readFileSync(new URL("../../../packages/office-upstream/upstream/packages/" + rel, import.meta.url), "utf8");

const target = { slideIndex: 0, elementId: "tbl1" } as const;

const sampleEdits: TableEdit[] = [
  { op: "add_table", slideIndex: 0, rows: 2, cols: 2, xPx: 10, yPx: 10, wPx: 200, hPx: 100 },
  { op: "set_table_cell", ...target, row: 0, col: 0, paragraphs: [{ runs: [{ text: "A" }] }] },
  { op: "table_merge", ...target, kind: "merge-right", row: 0, col: 0 },
  { op: "table_structure", ...target, kind: "insert-row", index: 0, before: true },
  { op: "set_table_row_height", ...target, row: 1, hPx: 40 },
  { op: "set_table_col_width", ...target, col: 1, wPx: 80 },
  { op: "set_table_cell_anchor", ...target, row: 0, col: 1, anchor: "middle" },
  { op: "set_table_style", ...target, styleName: "zebraBlue" },
];

describe("vendored binding guard", () => {
  it("every edit maps to exactly one op and the emitted set is the vendored table registry", () => {
    const emitted = new Set<string>();
    for (const edit of sampleEdits) {
      const ops = buildTableOps(opened(), FIT, edit);
      expect(ops).toHaveLength(1);
      emitted.add(ops[0]!.op);
    }
    expect([...emitted].sort()).toEqual([
      "addTable",
      "setTableCell",
      "setTableCellAnchor",
      "setTableColWidth",
      "setTableRowHeight",
      "setTableStyle",
      "tableMerge",
      "tableStructure",
    ]);
  });

  it("every emitted op is registered as name: '<op>' in the vendored ops sources", () => {
    const insertOps = readVendored("pptx-ops/src/ops/insert-ops.ts");
    const tableOps = readVendored("pptx-ops/src/ops/table-ops.ts");
    const owned: Array<[string, string]> = [
      ["addTable", insertOps],
      ["setTableCell", tableOps],
      ["tableMerge", tableOps],
      ["tableStructure", tableOps],
      ["setTableRowHeight", tableOps],
      ["setTableCellAnchor", tableOps],
      ["setTableColWidth", tableOps],
      ["setTableStyle", tableOps],
    ];
    for (const [name, source] of owned) {
      expect(source).toContain(`name: '${name}'`);
    }
  });

  it("TABLE_STYLE_PRESET_NAMES matches the vendored TABLE_STYLE_PRESETS keys", () => {
    const source = readVendored("pptx-engine/src/table-edit.ts");
    const marker = "export const TABLE_STYLE_PRESETS: Record<string, TableStylePreset> = {";
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = source.slice(start + marker.length);
    const end = block.indexOf("\n}");
    expect(end).toBeGreaterThan(0);
    const keys = [...block.slice(0, end).matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*): \{/gm)].map((m) => m[1]);
    expect(keys).toEqual([...TABLE_STYLE_PRESET_NAMES]);
  });

  it("merge/structure kinds match the vendored engine op unions", () => {
    const engine = readVendored("pptx-engine/src/index.ts");
    for (const kind of ["merge-right", "merge-down", "split", "insert-row", "delete-row", "insert-col", "delete-col"]) {
      expect(engine).toContain(`'${kind}'`);
    }
  });
});

describe("buildTableOps exact op objects", () => {
  it("add_table converts the px offset and per-column/row px lists to EMU", () => {
    const edit: TableEdit = {
      op: "add_table",
      slideIndex: 0,
      rows: 2,
      cols: 2,
      xPx: 10,
      yPx: 20,
      wPx: 300,
      hPx: 150,
      colWidthsPx: [100, 200],
      rowHeightsPx: [50, 100],
      cellProps: [
        [{ anchor: "middle" }, undefined],
        [{ gridSpan: 2, hMerge: true }, { rowSpan: 2, vMerge: false }],
      ],
    };
    expect(buildTableOps(opened(), FIT, edit)).toStrictEqual([
      {
        op: "addTable",
        target: { slide: 0 },
        rows: 2,
        cols: 2,
        offset: { x: EMU(10), y: EMU(20), cx: EMU(300), cy: EMU(150) },
        colWidthsEmu: [EMU(100), EMU(200)],
        rowHeightsEmu: [EMU(50), EMU(100)],
        cellProps: [
          [{ anchor: "ctr" }, undefined],
          [{ gridSpan: 2, hMerge: true }, { rowSpan: 2, vMerge: false }],
        ],
      },
    ]);
  });

  it("add_table omits optional keys when the edit does not set them", () => {
    const [op] = buildTableOps(opened(), FIT, {
      op: "add_table",
      slideIndex: 0,
      rows: 1,
      cols: 1,
      xPx: 0,
      yPx: 0,
      wPx: 10,
      hPx: 10,
    });
    expect(op).toStrictEqual({
      op: "addTable",
      target: { slide: 0 },
      rows: 1,
      cols: 1,
      offset: { x: 0, y: 0, cx: EMU(10), cy: EMU(10) },
    });
  });

  it("px→EMU follows makePxToEmu's fitWidth scale (canvas pixels, not device pixels)", () => {
    const [op] = buildTableOps(opened(), 480, {
      op: "set_table_col_width",
      ...target,
      col: 0,
      wPx: 10,
    });
    // deck width 960px at 96 DPI scaled to 480 → half scale → 10px is 20 base px.
    expect(op).toStrictEqual({
      op: "setTableColWidth",
      target: { slide: 0, el: "tbl1" },
      col: 0,
      wEmu: Math.round((10 / 0.5) * EMU_PER_PX_96),
    });
  });

  it("set_table_cell passes the EditParagraph array through by reference", () => {
    const paragraphs: PptxParagraphLike[] = [
      { runs: [{ text: "A", bold: true }], align: "center" },
      { runs: [{ text: "B" }] },
    ];
    const [op] = buildTableOps(opened(), FIT, {
      op: "set_table_cell",
      ...target,
      row: 1,
      col: 2,
      paragraphs,
    });
    expect(op).toStrictEqual({
      op: "setTableCell",
      target: { slide: 0, el: "tbl1" },
      row: 1,
      col: 2,
      paragraphs,
    });
    expect(op!.paragraphs).toBe(paragraphs);
  });

  it("table_merge carries kind + row/col", () => {
    const [op] = buildTableOps(opened(), FIT, {
      op: "table_merge",
      ...target,
      kind: "merge-down",
      row: 2,
      col: 3,
    });
    expect(op).toStrictEqual({
      op: "tableMerge",
      target: { slide: 0, el: "tbl1" },
      kind: "merge-down",
      row: 2,
      col: 3,
    });
  });

  it("table_structure carries before only when set", () => {
    const [withBefore] = buildTableOps(opened(), FIT, {
      op: "table_structure",
      ...target,
      kind: "insert-col",
      index: 1,
      before: true,
    });
    expect(withBefore).toStrictEqual({
      op: "tableStructure",
      target: { slide: 0, el: "tbl1" },
      kind: "insert-col",
      index: 1,
      before: true,
    });
    const [without] = buildTableOps(opened(), FIT, {
      op: "table_structure",
      ...target,
      kind: "delete-row",
      index: 0,
    });
    expect(without).toStrictEqual({
      op: "tableStructure",
      target: { slide: 0, el: "tbl1" },
      kind: "delete-row",
      index: 0,
    });
    expect(Object.keys(without as Record<string, unknown>)).not.toContain("before");
  });

  it("row height and column width convert px to hEmu/wEmu", () => {
    const [height] = buildTableOps(opened(), FIT, {
      op: "set_table_row_height",
      ...target,
      row: 3,
      hPx: 40,
    });
    expect(height).toStrictEqual({
      op: "setTableRowHeight",
      target: { slide: 0, el: "tbl1" },
      row: 3,
      hEmu: EMU(40),
    });
    const [width] = buildTableOps(opened(), FIT, {
      op: "set_table_col_width",
      ...target,
      col: 0,
      wPx: 90,
    });
    expect(width).toStrictEqual({
      op: "setTableColWidth",
      target: { slide: 0, el: "tbl1" },
      col: 0,
      wEmu: EMU(90),
    });
  });

  it("set_table_cell_anchor passes top/middle/bottom through", () => {
    const [op] = buildTableOps(opened(), FIT, {
      op: "set_table_cell_anchor",
      ...target,
      row: 0,
      col: 1,
      anchor: "bottom",
    });
    expect(op).toStrictEqual({
      op: "setTableCellAnchor",
      target: { slide: 0, el: "tbl1" },
      row: 0,
      col: 1,
      anchor: "bottom",
    });
  });

  it("style preset wins over other fields and emits styleName alone", () => {
    const [op] = buildTableOps(opened(), FIT, {
      op: "set_table_style",
      ...target,
      styleName: "zebraBlue",
      firstRow: false,
      shadingColor: "#FFFFFF",
      keepFormatting: true,
    });
    expect(op).toStrictEqual({ op: "setTableStyle", target: { slide: 0, el: "tbl1" }, styleName: "zebraBlue" });
  });

  it("styleId carries flags/colors/borders/cells and keepFormatting only with styleId", () => {
    const [op] = buildTableOps(opened(), FIT, {
      op: "set_table_style",
      ...target,
      styleId: " Medium Style 2 - Accent 1 ",
      keepFormatting: true,
      firstRow: true,
      bandRow: false,
      rtl: true,
      shadingColor: "#D6E4F0",
      borderColor: "#BFBFBF",
      borderWidthPt: 1.5,
      borderPreset: "all",
      cells: [{ row: 0, col: 1 }],
    });
    expect(op).toStrictEqual({
      op: "setTableStyle",
      target: { slide: 0, el: "tbl1" },
      styleId: "Medium Style 2 - Accent 1",
      keepFormatting: true,
      firstRow: true,
      bandRow: false,
      rtl: true,
      shadingColor: "#D6E4F0",
      borderColor: "#BFBFBF",
      borderWidthPt: 1.5,
      borderPreset: "all",
      cells: [{ row: 0, col: 1 }],
    });
    const [plain] = buildTableOps(opened(), FIT, {
      op: "set_table_style",
      ...target,
      styleId: "No Style, No Grid",
      shadingColor: "none",
    });
    expect(plain).toStrictEqual({
      op: "setTableStyle",
      target: { slide: 0, el: "tbl1" },
      styleId: "No Style, No Grid",
      shadingColor: "none",
    });
    expect(Object.keys(plain as Record<string, unknown>)).not.toContain("keepFormatting");
  });

  it("a flags-only style edit emits just those flags", () => {
    const [op] = buildTableOps(opened(), FIT, {
      op: "set_table_style",
      ...target,
      firstRow: true,
      lastRow: false,
    });
    expect(op).toStrictEqual({
      op: "setTableStyle",
      target: { slide: 0, el: "tbl1" },
      firstRow: true,
      lastRow: false,
    });
  });

  it("non-geometry edits never require the deck scale; geometry edits do", () => {
    const noSize: OpenedPptxLike = { deck: { slides: [{ id: "s1", elements: [{ id: "tbl1", type: "table" }] }] } };
    const cellEdit: TableEdit = {
      op: "set_table_cell",
      ...target,
      row: 0,
      col: 0,
      paragraphs: [{ runs: [{ text: "A" }] }],
    };
    expect(codeOf(() => buildTableOps(noSize, 0, cellEdit))).toBe("");
    expect(codeOf(() => buildTableOps(noSize, FIT, { op: "add_table", slideIndex: 0, rows: 1, cols: 1, xPx: 0, yPx: 0, wPx: 10, hPx: 10 }))).toBe("deck_size_missing");
    expect(codeOf(() => buildTableOps(opened(), 0, { op: "set_table_col_width", ...target, col: 0, wPx: 10 }))).toBe("bad_fit_width");
  });
});

describe("buildTableOps refusals", () => {
  const addTable = (over: Partial<Extract<TableEdit, { op: "add_table" }>>): TableEdit => ({
    op: "add_table",
    slideIndex: 0,
    rows: 2,
    cols: 2,
    xPx: 0,
    yPx: 0,
    wPx: 200,
    hPx: 100,
    ...over,
  });

  const cases: Array<[string, TableEdit, string]> = [
    ["add_table rows < 1", addTable({ rows: 0 }), "bad_table_size"],
    ["add_table cols < 1", addTable({ cols: 0 }), "bad_table_size"],
    ["add_table non-integer cols", addTable({ cols: 1.5 }), "bad_table_size"],
    ["add_table colWidths wrong length", addTable({ colWidthsPx: [10] }), "bad_table_size"],
    ["add_table rowHeights wrong length", addTable({ rowHeightsPx: [10] }), "bad_table_size"],
    ["add_table rowHeights non-positive value", addTable({ rowHeightsPx: [0, 10] }), "bad_table_rect"],
    ["add_table negative x", addTable({ xPx: -1 }), "bad_table_rect"],
    ["add_table zero height", addTable({ hPx: 0 }), "bad_table_rect"],
    [
      "add_table cellProps not row-major",
      addTable({ cellProps: "nope" as unknown as Array<Array<undefined>> }),
      "bad_table_cell",
    ],
    [
      "add_table cellProps bad anchor",
      addTable({ cellProps: [[{ anchor: "center" as TableCellAnchor }]] }),
      "bad_table_cell",
    ],
    ["add_table cellProps zero gridSpan", addTable({ cellProps: [[{ gridSpan: 0 }]] }), "bad_table_cell"],
    ["add_table missing slide", addTable({ slideIndex: 9 }), "no_slide"],
    [
      "set_table_cell missing element",
      { op: "set_table_cell", slideIndex: 0, elementId: "nope", row: 0, col: 0, paragraphs: [] },
      "no_element",
    ],
    [
      "set_table_cell non-table element",
      { op: "set_table_cell", slideIndex: 0, elementId: "txt1", row: 0, col: 0, paragraphs: [] },
      "no_element",
    ],
    [
      "set_table_cell bad row",
      { op: "set_table_cell", ...target, row: -1, col: 0, paragraphs: [] },
      "bad_table_cell",
    ],
    [
      "set_table_cell bad paragraphs",
      { op: "set_table_cell", ...target, row: 0, col: 0, paragraphs: "x" as unknown as PptxParagraphLike[] },
      "bad_table_cell",
    ],
    [
      "table_merge bad kind",
      { op: "table_merge", ...target, kind: "merge-left" as TableMergeKind, row: 0, col: 0 },
      "bad_table_merge",
    ],
    ["table_merge bad col", { op: "table_merge", ...target, kind: "split", row: 0, col: 1.2 }, "bad_table_merge"],
    [
      "table_structure bad kind",
      { op: "table_structure", ...target, kind: "insert-rowz" as unknown as "insert-row", index: 0 },
      "bad_table_structure",
    ],
    ["table_structure bad index", { op: "table_structure", ...target, kind: "insert-row", index: -1 }, "bad_table_structure"],
    ["row height non-positive hPx", { op: "set_table_row_height", ...target, row: 0, hPx: 0 }, "bad_table_rect"],
    ["row height bad row", { op: "set_table_row_height", ...target, row: -1, hPx: 10 }, "bad_table_cell"],
    ["col width negative wPx", { op: "set_table_col_width", ...target, col: 0, wPx: -5 }, "bad_table_rect"],
    [
      "cell anchor bad anchor",
      { op: "set_table_cell_anchor", ...target, row: 0, col: 0, anchor: "center" as TableCellAnchor },
      "bad_table_cell",
    ],
    [
      "style unknown preset name",
      { op: "set_table_style", ...target, styleName: "fancy" as TableStylePresetName },
      "bad_table_style",
    ],
    ["style no fields", { op: "set_table_style", ...target }, "bad_table_style"],
    ["style blank styleId", { op: "set_table_style", ...target, styleId: "  " }, "bad_table_style"],
    ["style bad shading hex", { op: "set_table_style", ...target, shadingColor: "blue" }, "bad_table_style"],
    ["style bad border hex", { op: "set_table_style", ...target, borderColor: "#GGGGGG" }, "bad_table_style"],
    ["style non-positive border width", { op: "set_table_style", ...target, borderWidthPt: 0 }, "bad_table_style"],
    [
      "style bad border preset",
      { op: "set_table_style", ...target, borderPreset: "outer" as unknown as "all" },
      "bad_table_style",
    ],
    ["style bad cells", { op: "set_table_style", ...target, cells: [{ row: -1, col: 0 }] }, "bad_table_style"],
    ["table op missing slide", { op: "table_merge", slideIndex: 9, elementId: "tbl1", kind: "split", row: 0, col: 0 }, "no_slide"],
  ];

  it.each(cases)("refuses %s with %s", (_name, edit, code) => {
    expect(codeOf(() => buildTableOps(opened(), FIT, edit))).toBe(code);
  });

  it("validates the target before geometry", () => {
    expect(codeOf(() => buildTableOps(opened(), FIT, addTable({ slideIndex: 9, rows: 0, wPx: 0 })))).toBe("no_slide");
  });
});
