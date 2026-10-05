import { describe, expect, it } from "vitest";
import {
  PDF_FIT_PADDING_PX,
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  clampPdfZoom,
  fitPdfZoom,
  pdfDisplaySize,
} from "./fit-zoom";

/** The A4 portrait page the r5 finding measured at 100%. */
const PORTRAIT = { width: 595, height: 842 };
/** The pane the r5 finding measured (975 x 575) at 1440. */
const PANE = { width: 975, height: 575 };

describe("pdfDisplaySize", () => {
  it("keeps the page box for an unrotated page", () => {
    expect(pdfDisplaySize({ width: 595, height: 842 })).toEqual({ width: 595, height: 842 });
    expect(pdfDisplaySize({ width: 595, height: 842, rotation: 0 })).toEqual({ width: 595, height: 842 });
  });

  it("swaps the axes for a quarter-turn page", () => {
    expect(pdfDisplaySize({ width: 595, height: 842, rotation: 90 })).toEqual({ width: 842, height: 595 });
    expect(pdfDisplaySize({ width: 595, height: 842, rotation: 270 })).toEqual({ width: 842, height: 595 });
  });

  it("keeps the axes for a half-turn page", () => {
    expect(pdfDisplaySize({ width: 595, height: 842, rotation: 180 })).toEqual({ width: 595, height: 842 });
  });
});

describe("fitPdfZoom", () => {
  it("fits the page width to the measured pane instead of resetting to 100% (F-12)", () => {
    const expected = Number(((PANE.width - PDF_FIT_PADDING_PX) / PORTRAIT.width).toFixed(2));
    expect(fitPdfZoom("fit-width", PANE, PORTRAIT)).toBe(expected);
    // 975 - 32 = 943 / 595 = 1.58, never 1.
    expect(fitPdfZoom("fit-width", PANE, PORTRAIT)).toBeGreaterThan(1);
  });

  it("fits the whole page to the shorter axis so it no longer overflows (F-12)", () => {
    const widthFit = (PANE.width - PDF_FIT_PADDING_PX) / PORTRAIT.width;
    const heightFit = (PANE.height - PDF_FIT_PADDING_PX) / PORTRAIT.height;
    expect(fitPdfZoom("fit-page", PANE, PORTRAIT)).toBe(Number(Math.min(widthFit, heightFit).toFixed(2)));
    expect(fitPdfZoom("fit-page", PANE, PORTRAIT)).toBeLessThan(1);
  });

  it("fits a rotated page by its displayed box, not its unrotated one", () => {
    const rotated = { width: 595, height: 842, rotation: 90 };
    expect(fitPdfZoom("fit-width", { width: 900, height: 575 }, rotated)).toBe(
      Number(((900 - PDF_FIT_PADDING_PX) / 842).toFixed(2)),
    );
    expect(fitPdfZoom("fit-page", { width: 900, height: 575 }, rotated)).toBe(
      Number(Math.min((900 - PDF_FIT_PADDING_PX) / 842, (575 - PDF_FIT_PADDING_PX) / 595).toFixed(2)),
    );
  });

  it("returns null when the pane or the page cannot be measured yet", () => {
    expect(fitPdfZoom("fit-width", { width: 0, height: 0 }, PORTRAIT)).toBeNull();
    expect(fitPdfZoom("fit-page", { width: 0, height: 575 }, PORTRAIT)).toBeNull();
    expect(fitPdfZoom("fit-page", PANE, { width: 0, height: 842 })).toBeNull();
    expect(fitPdfZoom("fit-width", PANE, { width: 595, height: 842 })).not.toBeNull();
  });

  it("clamps the fit into the zoom range", () => {
    expect(fitPdfZoom("fit-width", { width: 100_000, height: 100_000 }, PORTRAIT)).toBe(PDF_MAX_ZOOM);
    expect(fitPdfZoom("fit-page", { width: 20, height: 20 }, PORTRAIT)).toBe(PDF_MIN_ZOOM);
  });
});

describe("clampPdfZoom", () => {
  it("keeps the value in range and rounds to two decimals", () => {
    expect(clampPdfZoom(1.2345)).toBe(1.23);
    expect(clampPdfZoom(10)).toBe(PDF_MAX_ZOOM);
    expect(clampPdfZoom(0)).toBe(PDF_MIN_ZOOM);
  });
});
