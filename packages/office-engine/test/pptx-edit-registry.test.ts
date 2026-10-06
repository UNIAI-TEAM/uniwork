// PPTX edit-kind registry tests - P0-1 (UNI-927), extended by the WIRE round.
//
// The registry is the extension point the B1..B8 tasks add kinds to: the
// PptxEdit union and the kind -> handler table must agree, every registered
// kind must actually dispatch through the model's runTxn seam (one revision
// per applied edit), and an unregistered kind must be refused by code - never
// silently ignored.
//
// Every edit is applied on a fresh model so no kind depends on another kind's
// side effects (the previous order-coupled form was not runnable under the
// lane's cloud-only vitest rule).
import { describe, expect, it } from "vitest";
import { createPptxAdapter, type PptxEdit, pptxEditKinds } from "../src/pptx";
import {
  createFakePptxEngine,
  createFakePptxOps,
  decodeFakePptx,
  FAKE_LAYOUT_PART,
  FAKE_MASTER_PART,
  fakeMasterFixture,
} from "./fake-pptx-engine";
import { makeFakePptxBytes, para } from "./fake-pptx-fixtures";

const DECLARED_KINDS: PptxEdit["op"][] = [
  "edit_text",
  "edit_transform",
  "add_element",
  "add_image",
  "replace_picture",
  "move_slide",
  "reorder_element",
  "set_slide_hidden",
  "duplicate_slide",
  "delete_slide",
  "add_blank_slide",
  "add_slide_with_layout",
  "delete_element",
  "apply_theme",
  "set_slide_size",
  "set_background",
  "set_slide_layout",
  "add_table",
  "set_table_cell",
  "table_merge",
  "table_structure",
  "set_table_row_height",
  "set_table_col_width",
  "set_table_cell_anchor",
  "set_table_style",
  "add_chart",
  "set_chart",
  "set_transition",
  "set_advance_time",
  "find_replace",
  "set_link",
  "add_section",
  "rename_section",
  "remove_section",
  "move_section",
  "set_sections",
  // Animation (B5e) + text formatting (A1e) kinds (WIRE delta).
  "add_animation",
  "remove_animation",
  "reorder_animation",
  "set_animations",
  "set_font",
  "set_paragraph_format",
  // Format/arrange (A4e), notes/comments (A5e), header/footer (B7e),
  // media (B8e) kinds (WIRE-KINDS delta).
  "set_fill",
  "set_stroke",
  "set_effects",
  "set_shape_geometry",
  "set_shape_adjust",
  "ungroup_element",
  "group_elements",
  "flip_elements",
  "set_text_anchor",
  "set_text_body_props",
  "align_elements",
  "distribute_elements",
  "set_notes",
  "add_comment",
  "delete_comment",
  "apply_header_footer",
  "insert_slide_pptx",
  "add_media",
  "add_smartart",
  "add_model3d",
  "add_connector",
  // Slide master / layout part edits (B6 wire).
  "master_edit_text",
  "master_set_transform",
  "master_set_fill",
  "master_set_stroke",
  "master_delete_element",
];

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String((error as { code?: string }).code ?? error);
  }
  return "";
};

const openModel = async (extra?: Parameters<typeof makeFakePptxBytes>[0]) => {
  const engine = createFakePptxEngine();
  const adapter = createPptxAdapter({ engine, ops: createFakePptxOps() });
  const out = await adapter.open({ bytes: makeFakePptxBytes(extra), format: "pptx", document_id: "registry" });
  if (out.outcome !== "opened") throw new Error("open failed");
  return { adapter, ref: out.document_model_ref, model: adapter.sessionOf(out.document_model_ref).model };
};

/** ungroup_element needs a group element; the standard deck has none. */
const GROUP_DECK: Parameters<typeof makeFakePptxBytes>[0] = {
  slides: [
    {
      elements: [
        { id: "grp1", type: "group", transform: { offset: { x: 0, y: 0, cx: 914400, cy: 914400 }, rot: 0 } },
      ],
    },
  ],
};
/** Per-kind fixture override (only the kinds whose target the deck lacks). */
const FIXTURE_FOR: Partial<Record<PptxEdit["op"], Parameters<typeof makeFakePptxBytes>[0]>> = {
  ungroup_element: GROUP_DECK,
  master_edit_text: fakeMasterFixture(),
  master_set_transform: fakeMasterFixture(),
  master_set_fill: fakeMasterFixture(),
  master_set_stroke: fakeMasterFixture(),
  master_delete_element: fakeMasterFixture(),
};

/** One valid edit per declared kind, in registry order. Each is applied on a
 * fresh deck, so the fixture only has to satisfy that single edit. */
const ONE_OF_EACH: PptxEdit[] = [
  { op: "edit_text", slideIndex: 0, elementId: "t1", paragraphs: [para("registry")] },
  { op: "edit_transform", slideIndex: 0, elementId: "s1", xPx: 10, yPx: 10, wPx: 100, hPx: 50 },
  { op: "add_element", slideIndex: 0, kind: "textbox", xPx: 0, yPx: 0, wPx: 100, hPx: 50 },
  { op: "add_image", slideIndex: 0, bytes: new Uint8Array([1]), ext: "png", xPx: 0, yPx: 0, wPx: 10, hPx: 10 },
  { op: "replace_picture", slideIndex: 0, elementId: "p1", bytes: new Uint8Array([2]), ext: "png" },
  { op: "move_slide", slideIndex: 0, toIndex: 1 },
  { op: "reorder_element", slideIndex: 0, elementId: "t1", dir: "back" },
  { op: "set_slide_hidden", slideIndex: 0, hidden: true },
  { op: "duplicate_slide", slideIndex: 0 },
  { op: "delete_slide", slideIndex: 1 },
  { op: "add_blank_slide", slideIndex: 0 },
  { op: "add_slide_with_layout", layout: "Title Slide" },
  { op: "delete_element", slideIndex: 0, elementId: "t1" },
  // Wave A/B (UNI-927).
  { op: "apply_theme", name: "Aurora", colors: { lt1: "#FFFFFF", dk1: "#000000" } },
  { op: "set_slide_size", cxEmu: 12192000, cyEmu: 6858000 },
  { op: "set_background", slideIndex: 0, kind: "solid", color: "#112233" },
  { op: "set_slide_layout", slideIndex: 0, layout: "Title Slide" },
  { op: "add_table", slideIndex: 0, rows: 2, cols: 2, xPx: 10, yPx: 20, wPx: 300, hPx: 150 },
  { op: "set_table_cell", slideIndex: 0, elementId: "tbl1", row: 0, col: 0, paragraphs: [para("A")] },
  { op: "table_merge", slideIndex: 0, elementId: "tbl1", kind: "merge-right", row: 0, col: 0 },
  { op: "table_structure", slideIndex: 0, elementId: "tbl1", kind: "insert-row", index: 0 },
  { op: "set_table_row_height", slideIndex: 0, elementId: "tbl1", row: 0, hPx: 40 },
  { op: "set_table_col_width", slideIndex: 0, elementId: "tbl1", col: 0, wPx: 80 },
  { op: "set_table_cell_anchor", slideIndex: 0, elementId: "tbl1", row: 0, col: 0, anchor: "middle" },
  { op: "set_table_style", slideIndex: 0, elementId: "tbl1", styleName: "zebraBlue" },
  {
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
  { op: "set_chart", slideIndex: 0, elementId: "chart1", patch: { kind: "line" } },
  { op: "set_transition", slideIndex: 0, kind: "fade" },
  { op: "set_advance_time", slideIndex: 0, ms: 5000 },
  { op: "find_replace", find: "slide", replace: "SLIDE" },
  { op: "set_link", slideIndex: 0, elementId: "s1", link: { kind: "url", url: "https://example.com" } },
  { op: "add_section", atSlideIndex: 0, name: "Intro" },
  { op: "rename_section", id: "{A}", name: "Renamed" },
  { op: "remove_section", id: "{A}" },
  { op: "move_section", id: "{A}", dir: "down" },
  { op: "set_sections", sections: [{ id: "{A}", name: "Intro", slideIndices: [0] }] },
  // Animation (B5e) + text formatting (A1e).
  { op: "add_animation", slideIndex: 0, elementId: "t1", effect: "fade" },
  { op: "remove_animation", slideIndex: 0, elementId: "t1" },
  { op: "reorder_animation", slideIndex: 0, seq: 0, to: 1 },
  {
    op: "set_animations",
    slideIndex: 0,
    items: [{ sourceId: "t1", effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 }],
  },
  { op: "set_font", slideIndex: 0, elementId: "t1", font: { bold: true } },
  { op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { align: "center" } },
  // Format/arrange (A4e).
  { op: "set_fill", slideIndex: 0, elementId: "t1", fill: "#112233" },
  { op: "set_stroke", slideIndex: 0, elementId: "p1", stroke: { color: "#112233", widthEmu: 12700 } },
  { op: "set_effects", slideIndex: 0, elementId: "s1", effects: { softEdge: 50800 } },
  { op: "set_shape_geometry", slideIndex: 0, elementId: "s1", prst: "roundRect" },
  { op: "set_shape_adjust", slideIndex: 0, elementId: "s1", adjust: { adj: 50000 } },
  { op: "ungroup_element", slideIndex: 0, elementId: "grp1" },
  { op: "group_elements", slideIndex: 0, elementIds: ["t1", "s1"] },
  { op: "flip_elements", slideIndex: 0, elementIds: ["t1"], axis: "h" },
  { op: "set_text_anchor", slideIndex: 0, elementId: "t1", anchor: "middle" },
  { op: "set_text_body_props", slideIndex: 0, elementId: "t1", props: { wrap: false } },
  { op: "align_elements", slideIndex: 0, elementIds: ["t1", "s1"], mode: "left" },
  { op: "distribute_elements", slideIndex: 0, elementIds: ["t1", "s1", "p1"], axis: "horizontal" },
  // Notes/comments (A5e).
  { op: "set_notes", slideIndex: 0, text: "Speaker notes" },
  { op: "add_comment", slideIndex: 0, text: "Nice deck", author: "Reviewer" },
  { op: "delete_comment", slideIndex: 0, authorId: 1, idx: 0 },
  // Header/footer + insert slide (B7e).
  { op: "apply_header_footer", settings: { footer: "Confidential", slideNum: true } },
  {
    op: "insert_slide_pptx",
    source: { slideXml: "<p:sld/>", rels: [], media: [], layoutChain: [] },
  },
  // Media + SmartArt (B8e).
  {
    op: "add_media",
    slideIndex: 0,
    kind: "video",
    ext: "mp4",
    bytes: new Uint8Array([1, 2, 3]),
    xPx: 10,
    yPx: 10,
    wPx: 100,
    hPx: 60,
  },
  {
    op: "add_smartart",
    slideIndex: 0,
    layout: "process",
    items: ["A", "B"],
    xPx: 10,
    yPx: 10,
    wPx: 200,
    hPx: 100,
  },
  {
    op: "add_model3d",
    slideIndex: 0,
    ext: "glb",
    bytes: new Uint8Array([4, 5]),
    xPx: 10,
    yPx: 10,
    wPx: 120,
    hPx: 90,
  },
  { op: "add_connector", slideIndex: 0, elementIds: ["t1", "s1"], kind: "elbow", arrow: "end" },
  // Slide master / layout parts (B6 wire): part-addressed, not slide-addressed.
  { op: "master_edit_text", part: FAKE_MASTER_PART, elementId: "m_title", paragraphs: [para("Master title")] },
  { op: "master_set_transform", part: FAKE_LAYOUT_PART, elementId: "l_title", xPx: 10, yPx: 10, wPx: 100, hPx: 50 },
  { op: "master_set_fill", part: FAKE_MASTER_PART, elementId: "m_body", fill: "#112233" },
  { op: "master_set_stroke", part: FAKE_MASTER_PART, elementId: "m_logo", stroke: { color: "#112233", widthEmu: 12700 } },
  { op: "master_delete_element", part: FAKE_MASTER_PART, elementId: "m_logo" },
];

describe("pptx edit-kind registry", () => {
  it("registers exactly the declared edit kinds, in registry order", () => {
    expect(pptxEditKinds()).toEqual(DECLARED_KINDS);
    expect(pptxEditKinds().length).toBe(new Set(pptxEditKinds()).size);
    expect(ONE_OF_EACH.map((edit) => edit.op)).toEqual(DECLARED_KINDS);
  });

  it("dispatches every registered kind through the runTxn seam with one revision per edit", async () => {
    for (const edit of ONE_OF_EACH) {
      const { model } = await openModel(FIXTURE_FOR[edit.op]);
      const result = model.applyEdit(edit);
      expect(result.applied, edit.op).toBe(true);
      expect(model.revision, edit.op).toBe(1);
      expect(model.dirty, edit.op).toBe(true);
      expect(model.journal.length, edit.op).toBeGreaterThanOrEqual(1);
      expect(model.journal[model.journal.length - 1]!.op.op, edit.op).not.toBe("");
    }
  });

  it("surfaces createdId for the inserting kinds and a table id for merge/structure", async () => {
    const { model } = await openModel();
    const created = model.applyEdit({
      op: "add_element",
      slideIndex: 0,
      kind: "textbox",
      xPx: 0,
      yPx: 0,
      wPx: 10,
      hPx: 10,
    });
    expect(typeof created.createdId).toBe("string");

    const table = await openModel();
    expect(
      table.model.applyEdit({
        op: "table_structure",
        slideIndex: 0,
        elementId: "tbl1",
        kind: "delete-col",
        index: 0,
      }).elementId,
    ).toBe("tbl1");
  });

  it("round-trips one kind per new module: edit -> savePptx -> reopen -> structure present", async () => {
    type SavedPkg = {
      slides: Array<{
        elements: Array<{ id: string; type?: string; fill?: unknown; layout?: string }>;
      }>;
      notes?: Record<string, string>;
      headerFooter?: Record<string, unknown>;
    };

    // Format (A4e): set_fill lands on the element the save serializes.
    {
      const { adapter, ref } = await openModel();
      adapter.edit(ref, { op: "set_fill", slideIndex: 0, elementId: "t1", fill: "#112233" });
      const saved = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
      const pkg = decodeFakePptx(saved.bytes) as unknown as SavedPkg;
      expect(pkg.slides[0]?.elements.find((e) => e.id === "t1")?.fill).toBe("#112233");
    }

    // Notes (A5e): set_notes lands on the notes part, not on a slide element.
    {
      const { adapter, ref } = await openModel();
      adapter.edit(ref, { op: "set_notes", slideIndex: 0, text: "Speaker notes" });
      const saved = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
      const pkg = decodeFakePptx(saved.bytes) as unknown as SavedPkg;
      expect(pkg.notes?.["0"]).toBe("Speaker notes");
    }

    // Header/footer (B7e): deck-level settings survive the round trip.
    {
      const { adapter, ref } = await openModel();
      adapter.edit(ref, { op: "apply_header_footer", settings: { footer: "Confidential", slideNum: true } });
      const saved = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
      const pkg = decodeFakePptx(saved.bytes) as unknown as SavedPkg;
      expect(pkg.headerFooter).toMatchObject({ footer: "Confidential", slideNum: true });
    }

    // Media (B8e): add_smartart mints an element that reopens with its layout.
    {
      const { adapter, ref } = await openModel();
      const result = adapter.edit(ref, {
        op: "add_smartart",
        slideIndex: 0,
        layout: "process",
        items: ["A", "B"],
        xPx: 10,
        yPx: 10,
        wPx: 200,
        hPx: 100,
      });
      expect(typeof result.createdId).toBe("string");
      const saved = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
      const pkg = decodeFakePptx(saved.bytes) as unknown as SavedPkg;
      const created = pkg.slides[0]?.elements.find((e) => e.id === result.createdId);
      expect(created?.type).toBe("smartart");
      expect(created?.layout).toBe("process");
    }
  });

  it("round-trips a master edit: edit -> savePptx -> reopen -> the master part shows the change", async () => {
    const { adapter, ref } = await openModel(fakeMasterFixture());
    adapter.edit(ref, { op: "master_set_fill", part: FAKE_MASTER_PART, elementId: "m_body", fill: "#112233" });
    adapter.edit(ref, { op: "master_edit_text", part: FAKE_LAYOUT_PART, elementId: "l_title", paragraphs: [para("Saved")] });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
    const reopened = await adapter.open({ bytes: saved.bytes, format: "pptx", document_id: "registry-reopen" });
    if (reopened.outcome !== "opened") throw new Error("reopen failed");
    const body = adapter.masterElements(reopened.document_model_ref, FAKE_MASTER_PART).find((e) => e.id === "m_body");
    expect(body?.fill).toBe("#112233");
    const title = adapter.masterElements(reopened.document_model_ref, FAKE_LAYOUT_PART).find((e) => e.id === "l_title");
    expect(title?.text).toBe("Saved");
  });

  it("refuses an unregistered kind with a typed error instead of ignoring it", async () => {
    const { model } = await openModel();
    const unregistered = { op: "set_wallpaper", value: "Office" } as unknown as PptxEdit;
    expect(errCode(() => model.applyEdit(unregistered))).toBe("unsupported_edit");
    expect(model.revision).toBe(0);
  });
});
