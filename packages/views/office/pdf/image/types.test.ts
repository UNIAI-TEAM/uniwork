import { describe, expect, it } from "vitest";
import type { PdfImageEditInput } from "./types";

describe("PdfImageEditInput", () => {
  it("models the four serialisable image edit kinds", () => {
    const insert: PdfImageEditInput = { kind: "insertImage", pageIndex: 0, rect: [0, 0, 10, 10], image: Uint8Array.from([1, 2, 3]), layer: "aboveText", rotate: 90 };
    const transform: PdfImageEditInput = { kind: "transformImage", pageIndex: 1, oldRect: [0, 0, 10, 10], rect: [1, 1, 11, 11], layer: "belowText", quarterTurns: 1 };
    const replace: PdfImageEditInput = { kind: "replaceImage", target: { page: 2, objectId: "image-1" }, image: Uint8Array.from([4, 5]), rect: [2, 2, 12, 12], quarterTurns: 2 };
    const remove: PdfImageEditInput = { kind: "deleteImage", pageIndex: 3, oldRect: [0, 0, 10, 10] };
    const inputs: PdfImageEditInput[] = [insert, transform, replace, remove];

    expect(inputs.map((input) => input.kind)).toEqual(["insertImage", "transformImage", "replaceImage", "deleteImage"]);
    expect(insert).toEqual({ kind: "insertImage", pageIndex: 0, rect: [0, 0, 10, 10], image: Uint8Array.from([1, 2, 3]), layer: "aboveText", rotate: 90 });
    expect(transform).toEqual({ kind: "transformImage", pageIndex: 1, oldRect: [0, 0, 10, 10], rect: [1, 1, 11, 11], layer: "belowText", quarterTurns: 1 });
    expect(replace).toEqual({ kind: "replaceImage", target: { page: 2, objectId: "image-1" }, image: Uint8Array.from([4, 5]), rect: [2, 2, 12, 12], quarterTurns: 2 });
    expect(remove).toEqual({ kind: "deleteImage", pageIndex: 3, oldRect: [0, 0, 10, 10] });
  });
});
