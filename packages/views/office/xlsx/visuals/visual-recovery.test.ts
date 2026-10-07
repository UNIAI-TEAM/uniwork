import { describe, expect, it } from "vitest";
import { fileEditsFromStream, visualsFromStream } from "./visual-recovery";

const anchor = (row: number) => ({ fromRow: row, fromColumn: 0, fromRowOffset: 0, fromColumnOffset: 0, toRow: row + 2, toColumn: 2, toRowOffset: 0, toColumnOffset: 0 });
const shape = { shapeType: "rect" };
const image = { mediaType: "image/png", base64: "AAAA" };
const set = (id: string, sheet: string, row: number, body: Record<string, unknown> = { shape }) => ({ op: "set_visual", target: { sheet }, attributes: { id, anchor: anchor(row), ...body } });
const move = (id: string, sheet: string, row: number) => ({ op: "set_visual", target: { sheet }, attributes: { id, anchor: anchor(row) } });

describe("visualsFromStream", () => {
  it("folds inserts, moves and removes in stream order", () => {
    const visuals = visualsFromStream([
      set("a", "Data", 1),
      { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 1 } },
      set("b", "Data", 5, { image }),
      move("b", "Data", 9),
      set("c", "Data", 3),
      { op: "remove_visual", target: { sheet: "Data" }, attributes: { id: "c" } },
    ]);
    expect(visuals).toEqual([
      { id: "a", sheetName: "Data", anchor: anchor(1), shape },
      { id: "b", sheetName: "Data", anchor: anchor(9), image },
    ]);
  });

  it("reads a file move after a delete as a restore, and a delete after that as a delete", () => {
    const at = anchor(4);
    const file = (op: string, extra: Record<string, unknown> = {}) => ({ op, target: { sheet: "Data" }, attributes: { file: 1, ...extra } });
    expect(fileEditsFromStream([file("remove_visual"), file("set_visual", { anchor: at })])).toEqual([{ sheetName: "Data", file: 1, anchor: at }]);
    expect(fileEditsFromStream([file("remove_visual"), file("set_visual", { anchor: at }), file("remove_visual")])).toEqual([{ sheetName: "Data", file: 1, remove: true }]);
  });

  it("follows sheet renames and drops the visuals of a removed sheet", () => {
    const visuals = visualsFromStream([
      set("a", "Data", 1),
      set("b", "Old", 1),
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
      { op: "remove_sheet", target: { sheet: "Old" } },
    ]);
    expect(visuals.map((visual) => [visual.id, visual.sheetName])).toEqual([["a", "Budget"]]);
  });

  it("ignores malformed entries and a move whose insert the stream does not hold", () => {
    expect(visualsFromStream([null, "x", { op: "set_visual" }, { op: "set_visual", target: { sheet: "Data" }, attributes: { id: 3 } }, move("ghost", "Data", 1)])).toEqual([]);
  });
});
