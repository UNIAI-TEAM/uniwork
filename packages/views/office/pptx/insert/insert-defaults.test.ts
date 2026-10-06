import { describe, expect, it } from "vitest";
import { insertShapeEdit, insertTextBoxEdit } from "./insert-defaults";

describe("insert defaults", () => {
  it("styles a closed shape with the Office accent fill and its darker outline", () => {
    expect(insertShapeEdit(2, "rect")).toMatchObject({
      op: "add_element",
      slideIndex: 2,
      kind: "rect",
      fillColor: "#4472C4",
      stroke: { color: "#2F528F", widthPt: 1 },
    });
  });

  it("gives every closed shape a fresh stroke object", () => {
    const first = insertShapeEdit(0, "ellipse");
    const second = insertShapeEdit(0, "ellipse");
    expect(first.stroke).toEqual(second.stroke);
    expect(first.stroke).not.toBe(second.stroke);
  });

  it("leaves lines unfilled and keeps the vendored connector stroke", () => {
    for (const prst of ["line", "lineArrow", "lineArrowDouble", "lineBent", "lineCurved"]) {
      const edit = insertShapeEdit(0, prst);
      expect(edit.fillColor, prst).toBeUndefined();
      expect(edit.stroke, prst).toBeUndefined();
    }
  });

  it("carries the text box placeholder as the first paragraph, or nothing when blank", () => {
    expect(insertTextBoxEdit(0, "  Hộp văn bản ").paragraphs).toEqual([{ runs: [{ text: "Hộp văn bản" }] }]);
    expect(insertTextBoxEdit(0, "   ").paragraphs).toBeUndefined();
  });
});
