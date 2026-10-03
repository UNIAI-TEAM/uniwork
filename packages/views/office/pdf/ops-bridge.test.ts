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
