import { describe, expect, it, vi } from "vitest";
import { bridgePdfOperations, PdfOpsBridgeError } from "./ops-bridge";

const textTarget = { page: 1, objectId: "text-1" };
const imageTarget = { page: 2, objectId: "image-1" };

describe("bridgePdfOperations", () => {
  it("maps text and page operations to the engine vocabulary", async () => {
    await expect(bridgePdfOperations([
      { op: "replace_text", target: textTarget, text: "new" },
      { op: "delete_page", target: { page: 2 } },
      { op: "rotate_page", target: { page: 1 }, degrees: 270 },
    ], {
      resolveObject: () => ({ page: 1, objectId: "text-1", rect: [10, 20, 100, 40], text: "old", fontSize: 12 }),
    })).resolves.toEqual([
      { op: "putTextEdit", attributes: { pageIndex: 0, rect: [10, 20, 100, 40], oldText: "old", newText: "new", fontSize: 12 } },
      { op: "deletePage", attributes: { pageIndex: 1 } },
      { op: "rotatePages", attributes: { pages: [0], dir: -90 } },
    ]);
  });

  it("maps selected text quads to each markup subtype without touching object metadata", async () => {
    const selection = { page: 2, quads: [[10, 20, 80, 20, 10, 8, 80, 8]] } as const;
    await expect(bridgePdfOperations([
      { op: "add_markup", target: selection, type: "highlight", color: [1, 0.8, 0] },
      { op: "add_markup", target: selection, type: "underline", color: [0, 0, 0] },
      { op: "add_markup", target: selection, type: "strikeout", color: [0, 0, 0] },
    ])).resolves.toEqual([
      { op: "addMarkup", attributes: { markup: { pageIndex: 1, type: "highlight", color: [1, 0.8, 0], quads: [[10, 20, 80, 20, 10, 8, 80, 8]] } } },
      { op: "addMarkup", attributes: { markup: { pageIndex: 1, type: "underline", color: [0, 0, 0], quads: [[10, 20, 80, 20, 10, 8, 80, 8]] } } },
      { op: "addMarkup", attributes: { markup: { pageIndex: 1, type: "strikeout", color: [0, 0, 0], quads: [[10, 20, 80, 20, 10, 8, 80, 8]] } } },
    ]);
  });

  it("maps shape and freehand operations through displayed page order", async () => {
    await expect(bridgePdfOperations([
      { op: "add_drawing", target: { page: 2, geometry: { start: { x: 1, y: 2 }, end: { x: 30, y: 40 } } }, kind: "arrow", color: [0, 0, 1], width: 2 },
      { op: "add_drawing", target: { page: 1, geometry: { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } }, kind: "ink", color: [1, 0, 0], width: 3 },
    ], { pageOrder: [2, 0] })).resolves.toEqual([
      { op: "addDrawing", attributes: { drawing: { pageIndex: 0, kind: "arrow", geometry: { start: { x: 1, y: 2 }, end: { x: 30, y: 40 } }, color: [0, 0, 1], width: 2 } } },
      { op: "addDrawing", attributes: { drawing: { pageIndex: 2, kind: "ink", geometry: { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }, color: [1, 0, 0], width: 3 } } },
    ]);
  });

  it("rejects malformed drawing inputs as typed bridge errors", async () => {
    await expect(bridgePdfOperations([{ op: "add_drawing", target: { page: 0, geometry: { rect: { x: 1, y: 2, width: 30, height: 40 } } }, kind: "rect", color: [0, 0, 0], width: 1 }])).rejects.toMatchObject({ code: "invalid_target", operation: "add_drawing" });
    await expect(bridgePdfOperations([{ op: "add_drawing", target: { page: 1, geometry: { rect: { x: 1, y: 2, width: 30, height: 40 } } }, kind: "rect", color: [0, 0, 0], width: 0 }])).rejects.toMatchObject({ code: "invalid_target", operation: "add_drawing" });
    await expect(bridgePdfOperations([{ op: "add_drawing", target: { page: 1, geometry: { rect: { x: 1, y: 2, width: 0, height: 40 } } }, kind: "rect", color: [0, 0, 0], width: 1 }])).rejects.toMatchObject({ code: "invalid_target", operation: "add_drawing" });
    await expect(bridgePdfOperations([{ op: "add_drawing", target: { page: 1, geometry: { rect: { x: 1, y: Number.NaN, width: 30, height: 40 } } }, kind: "ellipse", color: [0, 0, 0], width: 1 }])).rejects.toMatchObject({ code: "invalid_target", operation: "add_drawing" });
    await expect(bridgePdfOperations([{ op: "add_drawing", target: { page: 1, geometry: { start: { x: 0, y: 0 }, end: { x: Number.POSITIVE_INFINITY, y: 5 } } }, kind: "line", color: [0, 0, 0], width: 1 }])).rejects.toMatchObject({ code: "invalid_target", operation: "add_drawing" });
    await expect(bridgePdfOperations([{ op: "add_drawing", target: { page: 1, geometry: { points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }] } }, kind: "ink", color: [0, 0, 0], width: 1 }])).rejects.toMatchObject({ code: "invalid_target", operation: "add_drawing" });
    await expect(bridgePdfOperations([{ op: "add_drawing", target: { page: 1, geometry: { points: [{ x: 0, y: 0 }] } }, kind: "ink", color: [0, 0, 0], width: 1 }])).rejects.toMatchObject({ code: "invalid_target", operation: "add_drawing" });
  });

  it("resolves asset ids and encodes bytes without importing the Node engine", async () => {
    const read = vi.fn(async () => new Uint8Array([0, 1, 255]));
    await expect(bridgePdfOperations([{ op: "replace_image", target: imageTarget, assetId: "asset-1" }], {
      assets: { read },
      resolveObject: () => imageTargetMetadata,
    })).resolves.toEqual([{ op: "addImageEdit", attributes: { kind: "replaceImage", pageIndex: 1, oldRect: [1, 2, 30, 40], rect: [1, 2, 30, 40], image: "AAH/", layer: "aboveText" } }]);
    expect(read).toHaveBeenCalledWith("asset-1");
  });

  it("maps a move against the supplied page order", async () => {
    await expect(bridgePdfOperations([{ op: "reorder_page", target: { page: 3 }, index: 0 }], { pageOrder: [0, 1, 2] })).resolves.toEqual([{ op: "setPageOrder", attributes: { order: [2, 0, 1] } }]);
  });

  it.each(["insert_page", "extract_page", "merge_pages"] as const)("rejects dead operation %s before provider access", async (op) => {
    const result = bridgePdfOperations([{ op, ...(op === "insert_page" ? { target: { index: 0 } } : op === "extract_page" ? { target: { page: 1 } } : { target: { pages: [1] } }) } as never]);
    await expect(result).rejects.toMatchObject({ code: "unsupported_operation", operation: op });
  });

  it("returns typed errors for missing object or asset providers", async () => {
    await expect(bridgePdfOperations([{ op: "replace_text", target: textTarget, text: "new" }])).rejects.toBeInstanceOf(PdfOpsBridgeError);
    await expect(bridgePdfOperations([{ op: "replace_image", target: imageTarget, assetId: "asset" }], { resolveObject: () => imageTargetMetadata })).rejects.toMatchObject({ code: "asset_provider_missing" });
  });

const imageTargetMetadata = { page: 2, objectId: "image-1", rect: [1, 2, 30, 40] as [number, number, number, number], layer: "aboveText" as const };

  it("maps displayed positions through a non-identity page order", async () => {
    const result = await bridgePdfOperations([
      { op: "delete_page", target: { page: 1 } },
      { op: "rotate_page", target: { page: 1 }, degrees: 90 },
    ], { pageOrder: [2, 0, 1] });
    expect(result).toEqual([
      { op: "deletePage", attributes: { pageIndex: 2 } },
      { op: "rotatePages", attributes: { pages: [0], dir: 90 } },
    ]);
  });

  it("maps replace_text through a non-identity page order and resolves the displayed page", async () => {
    const resolveObject = vi.fn(() => ({
      page: 2,
      objectId: "text-1",
      rect: [10, 20, 100, 40] as [number, number, number, number],
      text: "old",
      fontSize: 12,
    }));
    await expect(bridgePdfOperations([
      { op: "replace_text", target: { page: 2, objectId: "text-1" }, text: "new" },
    ], { pageOrder: [2, 0, 1], resolveObject })).resolves.toEqual([
      { op: "putTextEdit", attributes: { pageIndex: 0, rect: [10, 20, 100, 40], oldText: "old", newText: "new", fontSize: 12 } },
    ]);
    expect(resolveObject).toHaveBeenCalledWith({ page: 2, objectId: "text-1" });
  });

  it("maps replace_image through a non-identity page order and resolves the displayed page", async () => {
    const resolveObject = vi.fn(() => ({
      page: 1,
      objectId: "image-1",
      rect: [1, 2, 30, 40] as [number, number, number, number],
    }));
    const read = vi.fn(async () => new Uint8Array([0, 1, 255]));
    await expect(bridgePdfOperations([
      { op: "replace_image", target: { page: 1, objectId: "image-1" }, assetId: "asset-1" },
    ], { pageOrder: [2, 0, 1], assets: { read }, resolveObject })).resolves.toEqual([
      { op: "addImageEdit", attributes: { kind: "replaceImage", pageIndex: 2, oldRect: [1, 2, 30, 40], rect: [1, 2, 30, 40], image: "AAH/" } },
    ]);
    expect(resolveObject).toHaveBeenCalledWith({ page: 1, objectId: "image-1" });
  });

  it("threads multiple display reorders and emits one final order", async () => {
    const result = await bridgePdfOperations([
      { op: "reorder_page", target: { page: 1 }, index: 2 },
      { op: "reorder_page", target: { page: 2 }, index: 0 },
    ], { pageOrder: [2, 0, 1] });
    expect(result).toEqual([{ op: "setPageOrder", attributes: { order: [1, 0, 2] } }]);
  });

  it("keeps a delete plus reorder order compatible with the survivor list", async () => {
    const result = await bridgePdfOperations([
      { op: "delete_page", target: { page: 1 } },
      { op: "reorder_page", target: { page: 1 }, index: 1 },
    ], { pageOrder: [0, 1, 2] });
    expect(result).toEqual([
      { op: "deletePage", attributes: { pageIndex: 0 } },
      { op: "setPageOrder", attributes: { order: [2, 1] } },
    ]);
  });

  it("wraps synchronous and asynchronous resolver failures", async () => {
    await expect(bridgePdfOperations([{ op: "replace_text", target: textTarget, text: "x" }], { resolveObject: () => { throw new Error("private"); } })).rejects.toMatchObject({ code: "object_unavailable" });
    await expect(bridgePdfOperations([{ op: "replace_text", target: textTarget, text: "x" }], { resolveObject: async () => { throw new Error("private"); } })).rejects.toMatchObject({ code: "object_unavailable" });
  });

  it("rejects page positions outside the current order", async () => {
    await expect(bridgePdfOperations([{ op: "delete_page", target: { page: 4 } }], { pageOrder: [0, 1, 2] })).rejects.toMatchObject({ code: "invalid_target" });
    await expect(bridgePdfOperations([{ op: "reorder_page", target: { page: 1 }, index: 3 }], { pageOrder: [0, 1, 2] })).rejects.toMatchObject({ code: "invalid_target" });
  });
});
