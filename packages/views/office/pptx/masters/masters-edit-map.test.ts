import { describe, expect, it } from "vitest";
import type { MasterEdit } from "@uniwork/office-engine/pptx";
import { toMasterEdit } from "./masters-edit-map";
import type { MasterPanelEdit } from "./masters-model";

const PART = "ppt/slideMasters/slideMaster1.xml";

describe("toMasterEdit", () => {
  it("maps text to one plain run per line, like the in-place text editor", () => {
    expect(toMasterEdit({ op: "master_edit_text", part: PART, elementId: "t1", text: "Title\nSub" })).toEqual({
      op: "master_edit_text",
      part: PART,
      elementId: "t1",
      paragraphs: [{ runs: [{ text: "Title" }] }, { runs: [{ text: "Sub" }] }],
    });
  });

  it("flattens the box into the engine's px geometry", () => {
    expect(toMasterEdit({ op: "master_set_transform", part: PART, elementId: "t1", box: { x: 1, y: 2, w: 30, h: 40 } })).toEqual({
      op: "master_set_transform",
      part: PART,
      elementId: "t1",
      xPx: 1,
      yPx: 2,
      wPx: 30,
      hPx: 40,
    });
  });

  it("maps a colour to a fill patch and null to the vendored none", () => {
    expect(toMasterEdit({ op: "master_set_fill", part: PART, elementId: "t1", color: "#12AB34" })).toEqual({
      op: "master_set_fill", part: PART, elementId: "t1", fill: "#12AB34",
    });
    expect(toMasterEdit({ op: "master_set_fill", part: PART, elementId: "t1", color: null })).toEqual({
      op: "master_set_fill", part: PART, elementId: "t1", fill: "none",
    });
  });

  it("maps an outline to a stroke patch in EMU, defaulting a blank width to 1pt", () => {
    expect(toMasterEdit({ op: "master_set_stroke", part: PART, elementId: "t1", color: "#FF0000", widthPt: 2.5 })).toEqual({
      op: "master_set_stroke", part: PART, elementId: "t1", stroke: { color: "#FF0000", widthEmu: 31750 },
    });
    expect(toMasterEdit({ op: "master_set_stroke", part: PART, elementId: "t1", color: "#000000" })).toEqual({
      op: "master_set_stroke", part: PART, elementId: "t1", stroke: { color: "#000000", widthEmu: 12700 },
    });
  });

  it("removes the outline for no colour or a zero width", () => {
    const none: MasterEdit = { op: "master_set_stroke", part: PART, elementId: "t1", stroke: null };
    expect(toMasterEdit({ op: "master_set_stroke", part: PART, elementId: "t1", color: null })).toEqual(none);
    expect(toMasterEdit({ op: "master_set_stroke", part: PART, elementId: "t1", color: "#000000", widthPt: 0 })).toEqual(none);
  });

  it("keeps a delete as is and covers every panel kind", () => {
    const edits: MasterPanelEdit[] = [
      { op: "master_edit_text", part: PART, elementId: "a", text: "x" },
      { op: "master_set_transform", part: PART, elementId: "a", box: { x: 0, y: 0, w: 1, h: 1 } },
      { op: "master_set_fill", part: PART, elementId: "a", color: null },
      { op: "master_set_stroke", part: PART, elementId: "a", color: null },
      { op: "master_delete_element", part: PART, elementId: "a" },
    ];
    expect(edits.map((edit) => toMasterEdit(edit).op)).toEqual(edits.map((edit) => edit.op));
    expect(toMasterEdit({ op: "master_delete_element", part: PART, elementId: "a" })).toEqual({ op: "master_delete_element", part: PART, elementId: "a" });
  });

  it("maps the T01 part edits: rename and text style pass through, a new placeholder flattens its box", () => {
    expect(toMasterEdit({ op: "master_rename", part: PART, name: "Brand" })).toEqual({ op: "master_rename", part: PART, name: "Brand" });
    expect(toMasterEdit({ op: "master_add_placeholder", part: PART, placeholder: "pic", box: { x: 1, y: 2, w: 3, h: 4 } })).toEqual({
      op: "master_add_placeholder", part: PART, placeholder: "pic", xPx: 1, yPx: 2, wPx: 3, hPx: 4,
    });
    const style: MasterPanelEdit = { op: "master_set_text_style", part: PART, placeholder: "title", sizePt: 40, bold: true };
    expect(toMasterEdit(style)).toEqual(style);
  });
});
