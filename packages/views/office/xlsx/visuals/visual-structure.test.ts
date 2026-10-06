import { describe, expect, it } from "vitest";
import { appendedFrom, applyOverlayShifts, streamOpKey, structuralShiftsOf } from "./visual-structure";
import { fileEditsFromStream, visualsFromStream } from "./visual-recovery";
import type { XlsxEditorVisual } from "./visual-model";

const ANCHOR = { fromRow: 4, fromColumn: 1, fromRowOffset: 50, fromColumnOffset: 0, toRow: 8, toColumn: 3, toRowOffset: 0, toColumnOffset: 0 };
const rows = (op: string, index: number, count: number, sheet = "Data") => ({ op, target: { sheet }, attributes: { index, count } });
const visual = (id: string, extra: Partial<XlsxEditorVisual> = {}): XlsxEditorVisual => ({ id, sheetId: "s1", anchor: ANCHOR, generation: 1, ...extra });
const sheetIdOf = (name: string) => ({ Data: "s1", Other: "s2" } as Record<string, string>)[name];

describe("appendedFrom", () => {
  it("finds the new tail after an append, a save's head trim, or both", () => {
    expect(appendedFrom([], ["a", "b"])).toBe(0);
    expect(appendedFrom(["a", "b"], ["a", "b", "c"])).toBe(2);
    expect(appendedFrom(["a", "b", "c"], ["c", "d"])).toBe(1);
    expect(appendedFrom(["a", "b"], [])).toBe(0);
    expect(appendedFrom(["a", "b"], ["x"])).toBe(0);
    expect(appendedFrom(["a", "b"], ["a", "b"])).toBe(2);
  });

  it("keys a picture insert by id and anchor, not by its bytes", () => {
    const op = { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "p1", anchor: ANCHOR, image: { mediaType: "image/png", base64: "A".repeat(1000) } } };
    expect(streamOpKey(op)).not.toContain("AAAA");
    expect(streamOpKey(op)).toBe(streamOpKey(structuredClone(op)));
  });
});

describe("overlay shifts", () => {
  it("shifts every visual of the sheet like the gateway, but not absolute anchors, other sheets, or visuals a later op placed", () => {
    const shifts = structuralShiftsOf([
      rows("insert_rows", 0, 2),
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "later", anchor: ANCHOR } },
      { op: "remove_visual", target: { sheet: "Data" }, attributes: { file: 3 } },
      { op: "set_cell", target: { sheet: "Data", address: "A1" } },
    ]);
    expect(shifts).toHaveLength(1);
    const out = applyOverlayShifts([
      visual("v1"),
      visual("later"),
      visual("file-s1-2", { file: 2 }),
      visual("file-s1-3", { file: 3 }),
      visual("abs", { file: 4, position: { x: 0, y: 0 }, extent: { cx: 1, cy: 1 } }),
      visual("other", { sheetId: "s2" }),
    ], shifts, sheetIdOf);
    expect(out.map((entry) => [entry.id, entry.anchor.fromRow, entry.anchor.toRow])).toEqual([
      ["v1", 6, 10], ["later", 4, 8], ["file-s1-2", 6, 10], ["file-s1-3", 4, 8], ["abs", 4, 8], ["other", 4, 8],
    ]);
  });

  it("clamps a mark inside deleted columns to the band's start", () => {
    const [shifted] = applyOverlayShifts([visual("v1")], structuralShiftsOf([rows("remove_cols", 2, 5)]), sheetIdOf);
    expect(shifted?.anchor).toMatchObject({ fromColumn: 1, toColumn: 2, toColumnOffset: 0 });
  });

  it("recovered visuals and file edits carry the shifts that followed them in the stream", () => {
    const stream = [
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor: ANCHOR, shape: { shapeType: "rect" } } },
      { op: "set_visual", target: { sheet: "Data" }, attributes: { file: 0, anchor: ANCHOR } },
      rows("insert_rows", 0, 3),
      rows("insert_rows", 0, 1, "Other"),
    ];
    expect(visualsFromStream(stream)[0]?.anchor).toMatchObject({ fromRow: 7, toRow: 11 });
    expect(fileEditsFromStream(stream)[0]?.anchor).toMatchObject({ fromRow: 7, toRow: 11 });
  });
});
