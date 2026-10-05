// WIRE round (UNI-927) - model-level proof that every wave-A/B edit kind is
// registered on PptxSessionModel: one representative edit per kind applied
// through PptxSessionModel.applyEdit against the fake engine harness, then
// asserted on the built vendored op shape, that the txn ran (revision), and
// that the edit is journaled.
//
// Scope note: the fake harness runs the model's real dry-run + atomic-apply
// txn seam and records the op objects the builders produced, but it is NOT the
// vendored pptx-engine. The full edit -> savePptx -> reopen proof on the real
// artifact is deferred to the cloud round (packages/office-upstream/
// pptx-renderer); nothing here fakes that.
import { describe, expect, it } from "vitest";
import { createPptxAdapter, type PptxEdit } from "../src/pptx";
import { createFakePptxEngine, createFakePptxOps } from "./fake-pptx-engine";
import { makeFakePptxBytes, para } from "./fake-pptx-fixtures";

const openModel = async () => {
  const engine = createFakePptxEngine();
  const adapter = createPptxAdapter({ engine, ops: createFakePptxOps() });
  const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "wire" });
  if (out.outcome !== "opened") throw new Error("open failed");
  return adapter.sessionOf(out.document_model_ref).model;
};

/** One representative edit per wave-A/B kind + the vendored op it must build. */
const WAVE_AB: Array<{ edit: PptxEdit; op: string }> = [
  { edit: { op: "apply_theme", name: "Aurora", colors: { lt1: "#FFFFFF", dk1: "#000000" } }, op: "applyTheme" },
  { edit: { op: "set_slide_size", cxEmu: 12192000, cyEmu: 6858000 }, op: "setSlideSize" },
  { edit: { op: "set_background", slideIndex: 0, kind: "solid", color: "#112233" }, op: "setBackground" },
  { edit: { op: "set_slide_layout", slideIndex: 0, layout: "Title Slide" }, op: "setSlideLayout" },
  {
    edit: { op: "add_table", slideIndex: 0, rows: 2, cols: 2, xPx: 10, yPx: 20, wPx: 300, hPx: 150 },
    op: "addTable",
  },
  {
    edit: { op: "set_table_cell", slideIndex: 0, elementId: "tbl1", row: 0, col: 0, paragraphs: [para("A")] },
    op: "setTableCell",
  },
  { edit: { op: "table_merge", slideIndex: 0, elementId: "tbl1", kind: "merge-right", row: 0, col: 0 }, op: "tableMerge" },
  {
    edit: { op: "table_structure", slideIndex: 0, elementId: "tbl1", kind: "insert-row", index: 0 },
    op: "tableStructure",
  },
  { edit: { op: "set_table_row_height", slideIndex: 0, elementId: "tbl1", row: 0, hPx: 40 }, op: "setTableRowHeight" },
  { edit: { op: "set_table_col_width", slideIndex: 0, elementId: "tbl1", col: 0, wPx: 80 }, op: "setTableColWidth" },
  {
    edit: { op: "set_table_cell_anchor", slideIndex: 0, elementId: "tbl1", row: 0, col: 0, anchor: "middle" },
    op: "setTableCellAnchor",
  },
  { edit: { op: "set_table_style", slideIndex: 0, elementId: "tbl1", styleName: "zebraBlue" }, op: "setTableStyle" },
  {
    edit: {
      op: "add_chart",
      slideIndex: 0,
      kind: "bar",
      xPx: 10,
      yPx: 20,
      wPx: 300,
      hPx: 200,
      categories: ["Q1", "Q2"],
      series: [{ name: "North", values: [1, 2] }],
    },
    op: "addChart",
  },
  { edit: { op: "set_chart", slideIndex: 0, elementId: "chart1", patch: { kind: "line" } }, op: "setChart" },
  { edit: { op: "set_transition", slideIndex: 0, kind: "fade" }, op: "setTransition" },
  { edit: { op: "set_advance_time", slideIndex: 0, ms: 5000 }, op: "setAdvanceTime" },
  { edit: { op: "find_replace", find: "slide", replace: "SLIDE" }, op: "findReplace" },
  {
    edit: { op: "set_link", slideIndex: 0, elementId: "t1", link: { kind: "url", url: "https://example.com" } },
    op: "setLink",
  },
  { edit: { op: "add_section", atSlideIndex: 0, name: "Intro" }, op: "addSection" },
  { edit: { op: "rename_section", id: "{A}", name: "Renamed" }, op: "renameSection" },
  { edit: { op: "remove_section", id: "{A}" }, op: "removeSection" },
  { edit: { op: "move_section", id: "{A}", dir: "down" }, op: "moveSection" },
  {
    edit: { op: "set_sections", sections: [{ id: "{A}", name: "Intro", slideIndices: [0] }] },
    op: "setSections",
  },
  // Animation (B5e) + text formatting (A1e) kinds (WIRE delta).
  { edit: { op: "add_animation", slideIndex: 0, elementId: "t1", effect: "fade" }, op: "addAnimation" },
  { edit: { op: "remove_animation", slideIndex: 0, elementId: "t1" }, op: "removeAnimation" },
  { edit: { op: "reorder_animation", slideIndex: 0, seq: 0, to: 1 }, op: "reorderAnimation" },
  {
    edit: {
      op: "set_animations",
      slideIndex: 0,
      items: [{ sourceId: "t1", effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 }],
    },
    op: "setAnimations",
  },
  { edit: { op: "set_font", slideIndex: 0, elementId: "t1", font: { bold: true } }, op: "setFont" },
  {
    edit: { op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { align: "center" } },
    op: "setParagraphFormat",
  },
];

const lastOp = (model: { journal: Array<{ op: { op: string } }> }) => model.journal[model.journal.length - 1]!.op;

describe("wave-A/B kinds are registered on PptxSessionModel", () => {
  it("applies one representative edit per kind: txn ran (revision) and the op is journaled", async () => {
    for (const { edit, op } of WAVE_AB) {
      // fresh model per kind so every target exists independent of order
      const model = await openModel();
      const result = model.applyEdit(edit);
      expect(result.applied, edit.op).toBe(true);
      expect(model.revision, edit.op).toBe(1);
      expect(model.dirty, edit.op).toBe(true);
      expect(lastOp(model).op, edit.op).toBe(op);
    }
  });

  it("builds the exact vendored op shape for representative edits", async () => {
    const model = await openModel();
    model.applyEdit({
      op: "add_table",
      slideIndex: 0,
      rows: 2,
      cols: 2,
      xPx: 10,
      yPx: 20,
      wPx: 300,
      hPx: 150,
    });
    expect(lastOp(model)).toStrictEqual({
      op: "addTable",
      target: { slide: 0 },
      rows: 2,
      cols: 2,
      offset: { x: 10 * 9525, y: 20 * 9525, cx: 300 * 9525, cy: 150 * 9525 },
    });

    const chart = await openModel();
    chart.applyEdit({
      op: "add_chart",
      slideIndex: 0,
      kind: "bar",
      xPx: 10,
      yPx: 20,
      wPx: 300,
      hPx: 200,
      categories: ["Q1"],
      series: [{ name: "North", values: [1, 2, 3] }],
      title: "Revenue",
    });
    expect(lastOp(chart)).toStrictEqual({
      op: "addChart",
      target: { slide: 0 },
      kind: "bar",
      offset: { x: 10 * 9525, y: 20 * 9525, cx: 300 * 9525, cy: 200 * 9525 },
      categories: ["Q1"],
      series: [{ name: "North", values: [1, 2, 3] }],
      title: "Revenue",
    });

    const theme = await openModel();
    theme.applyEdit({ op: "apply_theme", name: "Aurora", colors: { lt1: "#FFFFFF" } });
    expect(lastOp(theme)).toStrictEqual({ op: "applyTheme", name: "Aurora", colors: { lt1: "#FFFFFF" } });

    const bg = await openModel();
    bg.applyEdit({ op: "set_background", slideIndex: 1, kind: "solid", color: "#0B1F3A" });
    expect(lastOp(bg)).toStrictEqual({
      op: "setBackground",
      target: { slide: 1 },
      kind: "solid",
      color: "#0B1F3A",
    });

    const transition = await openModel();
    transition.applyEdit({ op: "set_transition", slideIndex: 1, kind: "morph" });
    expect(lastOp(transition)).toStrictEqual({ op: "setTransition", target: { slide: 1 }, kind: "morph" });

    const advance = await openModel();
    advance.applyEdit({ op: "set_advance_time", slideIndex: 1, ms: 0 });
    expect(lastOp(advance)).toStrictEqual({ op: "setAdvanceTime", target: { slide: 1 }, ms: 0 });

    const merge = await openModel();
    merge.applyEdit({ op: "table_merge", slideIndex: 0, elementId: "tbl1", kind: "merge-down", row: 1, col: 1 });
    expect(lastOp(merge)).toStrictEqual({
      op: "tableMerge",
      target: { slide: 0, el: "tbl1" },
      kind: "merge-down",
      row: 1,
      col: 1,
    });

    const link = await openModel();
    link.applyEdit({ op: "set_link", slideIndex: 0, elementId: "t1", link: { kind: "slide", slideIndex: 1 } });
    expect(lastOp(link)).toStrictEqual({
      op: "setLink",
      target: { slide: 0, el: "t1" },
      link: { kind: "slide", slideIndex: 1 },
    });

    const find = await openModel();
    find.applyEdit({ op: "find_replace", find: "slide", replace: "SLIDE", matchCase: true });
    expect(lastOp(find)).toStrictEqual({
      op: "findReplace",
      find: "slide",
      replace: "SLIDE",
      matchCase: true,
    });

    const sections = await openModel();
    sections.applyEdit({ op: "set_sections", sections: [{ id: "{A}", name: "Intro", slideIndices: [0] }] });
    expect(lastOp(sections)).toStrictEqual({
      op: "setSections",
      sections: [{ id: "{A}", name: "Intro", slideIndices: [0] }],
    });
    // WIRE delta: animation (B5e) + text formatting (A1e) exact op shapes.
    const anim = await openModel();
    anim.applyEdit({
      op: "add_animation",
      slideIndex: 0,
      elementId: "t1",
      effect: "fade",
      trigger: "onClick",
      durationMs: 500,
    });
    expect(lastOp(anim)).toStrictEqual({
      op: "addAnimation",
      target: { slide: 0, el: "t1" },
      effect: "fade",
      trigger: "onClick",
      durationMs: 500,
    });

    const font = await openModel();
    font.applyEdit({ op: "set_font", slideIndex: 0, elementId: "t1", font: { bold: true } });
    expect(lastOp(font)).toStrictEqual({
      op: "setFont",
      target: { slide: 0, el: "t1" },
      font: { bold: true },
    });

    const format = await openModel();
    format.applyEdit({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { align: "center" } });
    expect(lastOp(format)).toStrictEqual({
      op: "setParagraphFormat",
      target: { slide: 0, el: "t1" },
      format: { align: "center" },
    });
  });

  it("surfaces created ids (add_table/add_chart) and the surviving table id (merge/structure)", async () => {
    const created = await openModel();
    const table = created.applyEdit({
      op: "add_table",
      slideIndex: 0,
      rows: 1,
      cols: 1,
      xPx: 0,
      yPx: 0,
      wPx: 10,
      hPx: 10,
    });
    expect(typeof table.createdId).toBe("string");
    const chart = created.applyEdit({
      op: "add_chart",
      slideIndex: 0,
      kind: "pie",
      xPx: 0,
      yPx: 0,
      wPx: 10,
      hPx: 10,
      categories: ["A"],
      series: [{ name: "S", values: [1] }],
    });
    expect(typeof chart.createdId).toBe("string");

    // tableMerge/tableStructure reparse the slide; the fake records the
    // surviving element id in after.elementId, which the gesture surfaces.
    const merge = await openModel();
    expect(merge.applyEdit({ op: "table_merge", slideIndex: 0, elementId: "tbl1", kind: "merge-right", row: 0, col: 0 }).elementId).toBe(
      "tbl1",
    );
    const structure = await openModel();
    expect(
      structure.applyEdit({ op: "table_structure", slideIndex: 0, elementId: "tbl1", kind: "delete-col", index: 0 })
        .elementId,
    ).toBe("tbl1");
  });

  it("keeps validation + px->EMU in the builder: a bad target is refused before any txn", async () => {
    const model = await openModel();
    let code = "";
    try {
      model.applyEdit({ op: "set_table_cell", slideIndex: 0, elementId: "nope", row: 0, col: 0, paragraphs: [para("x")] });
    } catch (error) {
      code = String((error as { code?: string }).code ?? error);
    }
    expect(code).toBe("no_element");
    expect(model.revision).toBe(0);
    expect(model.journal.length).toBe(0);
  });
});
