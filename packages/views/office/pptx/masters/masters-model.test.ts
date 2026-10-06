import { describe, expect, it } from "vitest";
import {
  boxToDraft,
  buildDeleteEdit,
  buildFillEdit,
  buildStrokeEdit,
  buildTextEdit,
  buildTransformEdit,
  colorInputValue,
  groupMasterParts,
  isTextElement,
  normalizeMasterColor,
  parseBoxDraft,
  parseStrokeWidth,
  type MasterPartView,
} from "./masters-model";

const master = (n: number): MasterPartView => ({ partPath: "m" + n, kind: "master", name: "Master " + n });
const layout = (n: number): MasterPartView => ({ partPath: "l" + n, kind: "layout", name: "Layout " + n });

describe("groupMasterParts", () => {
  it("puts each master first with the layouts that follow it", () => {
    const groups = groupMasterParts([master(1), layout(1), layout(2), master(2), layout(3)]);
    expect(groups.map((g) => [g.master?.partPath, g.layouts.map((l) => l.partPath)])).toEqual([
      ["m1", ["l1", "l2"]],
      ["m2", ["l3"]],
    ]);
  });

  it("keeps leading layouts in a master-less group and handles empty input", () => {
    expect(groupMasterParts([layout(1), master(1)]).map((g) => g.master?.partPath ?? null)).toEqual([null, "m1"]);
    expect(groupMasterParts([])).toEqual([]);
  });
});

describe("parseBoxDraft", () => {
  it("accepts finite numbers with w and h at least 1", () => {
    expect(parseBoxDraft({ x: "-5", y: "0", w: "1", h: "10.5" })).toEqual({
      ok: true,
      box: { x: -5, y: 0, w: 1, h: 10.5 },
    });
  });

  it("names the first invalid field", () => {
    expect(parseBoxDraft({ x: "", y: "0", w: "5", h: "5" })).toEqual({ ok: false, field: "x" });
    expect(parseBoxDraft({ x: "0", y: "abc", w: "5", h: "5" })).toEqual({ ok: false, field: "y" });
    expect(parseBoxDraft({ x: "0", y: "0", w: "0.5", h: "5" })).toEqual({ ok: false, field: "w" });
    expect(parseBoxDraft({ x: "0", y: "0", w: "5", h: "-3" })).toEqual({ ok: false, field: "h" });
    expect(parseBoxDraft({ x: "1e99", y: "0", w: "5", h: "5" })).toEqual({ ok: false, field: "x" });
  });

  it("round-trips a box through its draft", () => {
    expect(boxToDraft({ x: 1.234, y: 2, w: 3, h: 4 })).toEqual({ x: "1.23", y: "2", w: "3", h: "4" });
  });
});

describe("colours and widths", () => {
  it("normalises hex colours", () => {
    expect(normalizeMasterColor("4472c4")).toBe("#4472C4");
    expect(normalizeMasterColor(" #4472c480 ")).toBe("#4472C480");
    expect(normalizeMasterColor("#FFF")).toBeNull();
    expect(normalizeMasterColor("nope")).toBeNull();
  });

  it("gives the colour input a valid seven-character value", () => {
    expect(colorInputValue("#4472c480", "#000000")).toBe("#4472C4");
    expect(colorInputValue("bad", "#123456")).toBe("#123456");
    expect(colorInputValue(null, "#123456")).toBe("#123456");
  });

  it("parses the outline width", () => {
    expect(parseStrokeWidth("")).toBeUndefined();
    expect(parseStrokeWidth("2.5")).toBe(2.5);
    expect(parseStrokeWidth("0")).toBe(0);
    expect(parseStrokeWidth("-1")).toBeNull();
    expect(parseStrokeWidth("x")).toBeNull();
    expect(parseStrokeWidth("2000")).toBeNull();
  });

  it("treats placeholders and text elements as text", () => {
    const base = { id: "a", label: "A", box: { x: 0, y: 0, w: 1, h: 1 } };
    expect(isTextElement({ ...base, type: "shape", placeholder: "title" })).toBe(true);
    expect(isTextElement({ ...base, type: "text" })).toBe(true);
    expect(isTextElement({ ...base, type: "shape" })).toBe(false);
  });
});

describe("edit builders", () => {
  it("build the exact engine-shaped edits", () => {
    expect(buildTextEdit("p", "e", "Hi")).toEqual({ op: "master_edit_text", part: "p", elementId: "e", text: "Hi" });
    expect(buildTransformEdit("p", "e", { x: 1, y: 2, w: 3, h: 4 })).toEqual({
      op: "master_set_transform",
      part: "p",
      elementId: "e",
      box: { x: 1, y: 2, w: 3, h: 4 },
    });
    expect(buildFillEdit("p", "e", null)).toEqual({ op: "master_set_fill", part: "p", elementId: "e", color: null });
    expect(buildStrokeEdit("p", "e", "#000000")).toEqual({
      op: "master_set_stroke",
      part: "p",
      elementId: "e",
      color: "#000000",
    });
    expect(buildStrokeEdit("p", "e", "#000000", 2)).toEqual({
      op: "master_set_stroke",
      part: "p",
      elementId: "e",
      color: "#000000",
      widthPt: 2,
    });
    expect(buildDeleteEdit("p", "e")).toEqual({ op: "master_delete_element", part: "p", elementId: "e" });
  });
});
