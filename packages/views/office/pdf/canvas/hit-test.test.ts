import { describe, expect, it } from "vitest";
import { hitTestPdfBox } from "./hit-test";

describe("hitTestPdfBox", () => {
  const boxes = [
    { id: "text", kind: "text" as const, x: 10, y: 10, width: 100, height: 30 },
    { id: "image", kind: "image" as const, x: 50, y: 20, width: 100, height: 100 },
  ];
  it("returns the topmost box and supports edge points", () => {
    expect(hitTestPdfBox(boxes, 60, 25)?.id).toBe("image");
    expect(hitTestPdfBox(boxes, 10, 10)?.id).toBe("text");
  });
  it("returns null outside all boxes", () => {
    expect(hitTestPdfBox(boxes, 0, 0)).toBeNull();
  });
});
