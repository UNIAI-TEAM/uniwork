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
});

const imageTargetMetadata = { page: 2, objectId: "image-1", rect: [1, 2, 30, 40] as [number, number, number, number], layer: "aboveText" as const };
