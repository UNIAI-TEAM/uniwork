import { describe, expect, it } from "vitest";
import type { PdfImageEditInput } from "./types";

describe("PdfImageEditInput", () => {
  it("models the four serialisable image edit kinds", () => {
    const inputs: PdfImageEditInput[] = [
      { kind: "insertImage", pageIndex: 0, rect: [0, 0, 10, 10], source: { assetId: "asset" }, layer: "aboveText" },
      { kind: "transformImage", pageIndex: 0, oldRect: [0, 0, 10, 10], rect: [1, 1, 11, 11], quarterTurns: 1 },
      { kind: "replaceImage", pageIndex: 0, oldRect: [0, 0, 10, 10], rect: [1, 1, 11, 11], source: { assetId: "asset" } },
      { kind: "deleteImage", pageIndex: 0, oldRect: [0, 0, 10, 10] },
    ];
    expect(inputs).toHaveLength(4);
  });
});
