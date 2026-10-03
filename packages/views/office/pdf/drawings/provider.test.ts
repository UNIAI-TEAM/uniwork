import { describe, expect, it, vi } from "vitest";
import { createPdfDrawingOperationProvider } from "./provider";

describe("PDF drawing provider", () => {
  it("maps page order and emits a serialisable drawing envelope", async () => {
    const submit = vi.fn();
    const provider = createPdfDrawingOperationProvider({ pageOrder: [2, 0] }, { submit });
    await provider.addDrawing({ pageIndex: 1, kind: "arrow", geometry: { start: { x: 1, y: 2 }, end: { x: 30, y: 40 } }, color: [0, 0, 1], width: 2 });
    expect(submit).toHaveBeenCalledWith([{ op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "arrow", geometry: { start: { x: 1, y: 2 }, end: { x: 30, y: 40 } }, color: [0, 0, 1], width: 2 } } }]);
  });
  it("rejects invalid width before submit", async () => {
    const submit = vi.fn();
    const provider = createPdfDrawingOperationProvider({}, { submit });
    await expect(provider.addDrawing({ pageIndex: 0, kind: "rect", geometry: { rect: { x: 0, y: 0, width: 1, height: 1 } }, color: [0, 0, 0], width: 0 })).rejects.toThrow("width");
    expect(submit).not.toHaveBeenCalled();
  });
});
