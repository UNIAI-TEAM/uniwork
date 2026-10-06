// UNI-924 A6: the read-only ruler renders the canvas section's geometry, the
// inch scale and the caret paragraph's indent markers.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RendererSection } from "@uniwork/office-upstream/docs-renderer-editor";
import { DocxRuler } from "./ruler";
import { docxRulerModel } from "./ruler-model";

// US Letter, 1in margins (twips).
const LETTER: RendererSection["settings"] = {
  pageWidth: 12240,
  pageHeight: 15840,
  marginTop: 1440,
  marginBottom: 1440,
  marginLeft: 1440,
  marginRight: 1440,
};

describe("docxRulerModel", () => {
  it("converts twips to px and lays out inch ticks", () => {
    const model = docxRulerModel(LETTER, 100);
    expect(model?.widthPx).toBeCloseTo(816, 5);
    expect(model?.marginLeftPx).toBeCloseTo(96, 5);
    expect(model?.marginRightPx).toBeCloseTo(96, 5);
    expect(model?.contentWidthPx).toBeCloseTo(624, 5);
    expect(model?.ticks.map((tick) => tick.inch)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(model?.ticks[7]?.leftPx).toBeCloseTo(768, 5);
    expect(docxRulerModel(null)).toBeNull();
  });

  it("scales every measure with the display zoom", () => {
    const model = docxRulerModel(LETTER, 150);
    expect(model?.widthPx).toBeCloseTo(1224, 5);
    expect(model?.marginLeftPx).toBeCloseTo(144, 5);
    expect(model?.ticks[1]?.leftPx).toBeCloseTo(288, 5);
  });
});

describe("DocxRuler", () => {
  it("renders the page width, margin zones and inch numbers", () => {
    render(<DocxRuler settings={LETTER} />);
    const ruler = screen.getByTestId("docx-ruler");
    expect(ruler).toHaveAccessibleName("Thước ngang");
    expect(Number.parseFloat(ruler.style.width)).toBeCloseTo(816, 5);
    expect(Number.parseFloat(screen.getByTestId("docx-ruler-margin-left").style.width)).toBeCloseTo(96, 5);
    const rightZone = screen.getByTestId("docx-ruler-margin-right");
    expect(Number.parseFloat(rightZone.style.width)).toBeCloseTo(96, 5);
    expect(Number.parseFloat(rightZone.style.left)).toBeCloseTo(720, 5);
    expect(ruler.textContent).toBe("12345678");
  });

  it("renders the caret paragraph indent markers, including a hanging first line", () => {
    render(<DocxRuler settings={LETTER} indent={{ leftTwips: 720, rightTwips: 360, firstLineTwips: -360 }} />);
    expect(Number.parseFloat(screen.getByTestId("docx-ruler-indent-left").style.left)).toBeCloseTo(144, 5);
    expect(Number.parseFloat(screen.getByTestId("docx-ruler-indent-right").style.left)).toBeCloseTo(696, 5);
    expect(Number.parseFloat(screen.getByTestId("docx-ruler-indent-first-line").style.left)).toBeCloseTo(120, 5);
  });

  it("omits indent markers without indent data and renders nothing without a page", () => {
    const { rerender } = render(<DocxRuler settings={LETTER} />);
    expect(screen.queryByTestId("docx-ruler-indent-left")).toBeNull();
    expect(screen.queryByTestId("docx-ruler-indent-first-line")).toBeNull();
    rerender(<DocxRuler settings={null} />);
    expect(screen.queryByTestId("docx-ruler")).toBeNull();
  });
});
