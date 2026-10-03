import { describe, expect, it, vi } from "vitest";
import { createPdfImageOperationProvider } from "./provider";

function bytes(...values: number[]): Uint8Array { return Uint8Array.from(values); }

describe("createPdfImageOperationProvider", () => {
  it("encodes insert bytes and maps the displayed page", async () => {
    const submit = vi.fn();
    const provider = createPdfImageOperationProvider({ pageOrder: [3, 0] }, { submit });
    await provider.insertImage({ pageIndex: 0, rect: [1, 2, 30, 40], image: bytes(0, 1, 255), layer: "belowText", rotate: 90 });
    expect(submit).toHaveBeenCalledWith([{ op: "addImageEdit", attributes: { kind: "insertImage", pageIndex: 3, rect: [1, 2, 30, 40], image: "AAH/", layer: "belowText", rotate: 90 } }]);
  });

  it("resolves selected image metadata for replace and maps non-identity order", async () => {
    const submit = vi.fn();
    const provider = createPdfImageOperationProvider({
      pageOrder: [2, 0],
      resolveObject: () => ({ page: 1, objectId: "image-1", rect: [1, 2, 30, 40], layer: "aboveText" }),
    }, { submit });
    await provider.replaceImage({ target: { page: 1, objectId: "image-1" }, image: bytes(4, 5), quarterTurns: 1 });
    expect(submit).toHaveBeenCalledWith([{ op: "addImageEdit", attributes: { kind: "replaceImage", pageIndex: 2, oldRect: [1, 2, 30, 40], rect: [1, 2, 30, 40], image: "BAU=", layer: "aboveText", quarterTurns: 1 } }]);
  });

  it("submits transform and delete operations without image bytes", async () => {
    const submit = vi.fn();
    const provider = createPdfImageOperationProvider({}, { submit });
    await provider.transformImage({ pageIndex: 1, oldRect: [1, 2, 30, 40], rect: [5, 6, 35, 46], quarterTurns: -1 });
    await provider.deleteImage({ pageIndex: 1, oldRect: [5, 6, 35, 46] });
    expect(submit).toHaveBeenNthCalledWith(1, [{ op: "addImageEdit", attributes: { kind: "transformImage", pageIndex: 1, oldRect: [1, 2, 30, 40], rect: [5, 6, 35, 46], quarterTurns: -1 } }]);
    expect(submit).toHaveBeenNthCalledWith(2, [{ op: "addImageEdit", attributes: { kind: "deleteImage", pageIndex: 1, oldRect: [5, 6, 35, 46], rect: [5, 6, 35, 46] } }]);
  });
});
