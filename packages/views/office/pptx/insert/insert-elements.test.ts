import { describe, expect, it } from "vitest";
import { box, chartNode, run, shapeNode, slide, textLayout } from "../canvas/pptx-render-fixtures";
import { pptxInsertElements } from "./insert-elements";

const text = (value: string) => textLayout({ lines: [{ runs: [run({ text: value })], top: 0, height: 24 }] });

describe("pptxInsertElements", () => {
  it("reads no elements without a rendition", () => {
    expect(pptxInsertElements(null)).toEqual([]);
  });

  it("lists the top-level slide elements by readable name, never by id", () => {
    const elements = pptxInsertElements(
      slide([
        shapeNode({ sourceId: "sp_0", text: text("  \nQuarterly results\nsecond line") }),
        shapeNode({ id: "r2", sourceId: "sp_1" }),
        shapeNode({ id: "r3", sourceId: "sp_2", text: text("A very long heading that would overflow the picker row") }),
        shapeNode({ id: "r4", sourceId: "sp_deco", decoration: true, text: text("Footer") }),
        shapeNode({ id: "r5", sourceId: "sp_bg", background: true }),
        chartNode({ box: box({ x: 300, y: 200, w: 400, h: 260 }) }),
      ]),
    );
    expect(elements.map((element) => element.id)).toEqual(["sp_0", "sp_1", "sp_2", "chart-1"]);
    expect(elements[0]).toEqual({ id: "sp_0", type: "shape", label: "Quarterly results" });
    // No text, no name: the picker numbers it ("Shape N"), so no label is invented.
    expect(elements[1]).toEqual({ id: "sp_1", type: "shape" });
    expect(elements[2]?.label).toMatch(/^A very long heading.*…$/);
    expect(elements[2]?.label?.length).toBeLessThanOrEqual(32);
    expect(elements[3]).toEqual({ id: "chart-1", type: "chart" });
  });
});

describe("pptxInsertElements connector flag", () => {
  it("marks a shape drawn as a line, so the pane restyles it instead of connecting to it", () => {
    const elements = pptxInsertElements(
      slide([
        shapeNode({ sourceId: "sp_0" }),
        shapeNode({ id: "r2", sourceId: "cxn_1", line: { points: [0, 0, 100, 0] } }),
      ]),
    );
    expect(elements[0]).toEqual({ id: "sp_0", type: "shape" });
    expect(elements[1]).toEqual({ id: "cxn_1", type: "shape", connector: true });
  });
});
