import { describe, expect, it, vi } from "vitest";
import { createPdfInkOperationProvider } from "./provider";

describe("PDF ink provider", () => {
  it("emits copied paths and mapped page", async () => {
    const submit = vi.fn();
    const provider = createPdfInkOperationProvider({ pageOrder: [4, 1] }, { submit });
    await provider.addInk({ pageIndex: 0, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: [1, 0, 0], width: 3 });
    expect(submit).toHaveBeenCalledWith([{ op: "addDrawing", attributes: { drawing: { pageIndex: 4, kind: "ink", geometry: { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }, color: [1, 0, 0], width: 3 } } }]);
  });
});
