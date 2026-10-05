import { describe, expect, it, vi } from "vitest";
import { createCanvasFontMetrics, type PptxMeasureContext } from "./canvas-metrics";
import type { PptxFontMetricsProvider, PptxRunStyle } from "./renderer-module";

const style = (patch: Partial<PptxRunStyle> = {}): PptxRunStyle => ({ fontFamily: "Calibri", fontSizePx: 16, bold: false, italic: false, ...patch });

function setup() {
  const fonts: string[] = [];
  const ctx: PptxMeasureContext = {
    font: "",
    fontKerning: "auto",
    measureText: vi.fn((text: string) => {
      fonts.push(ctx.font);
      return { width: text.length * 5 };
    }),
  };
  const fallback: PptxFontMetricsProvider = {
    metrics: vi.fn(() => ({ ascent: 11, descent: 3, lineHeight: 19 })),
    measure: vi.fn(() => 99),
  };
  return { ctx, fonts, fallback, provider: createCanvasFontMetrics(fallback, () => ctx)! };
}

describe("createCanvasFontMetrics", () => {
  it("measures with the stack text.ts renders, with bold and italic", () => {
    const { fonts, provider } = setup();
    expect(provider.measure("hello", style())).toBe(25);
    provider.measure("hello", style({ bold: true, italic: true, fontFamily: "Georgia", fontSizePx: 20 }));
    expect(fonts[0]).toBe("16px 'Calibri', 'Carlito', sans-serif");
    expect(fonts[1]).toBe("italic bold 20px 'Georgia', 'Gelasio', serif");
  });

  it("caches per font and text", () => {
    const { ctx, provider } = setup();
    provider.measure("abc", style());
    provider.measure("abc", style());
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    provider.measure("abc", style({ bold: true }));
    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });

  it("turns kerning off when the run asks for it", () => {
    const { ctx, provider } = setup();
    provider.measure("ab", style({ kerning: false }));
    expect(ctx.fontKerning).toBe("none");
    provider.measure("cd", style());
    expect(ctx.fontKerning).toBe("auto");
  });

  it("keeps the fallback's line metrics and falls back on a non-finite width", () => {
    const { ctx, fallback, provider } = setup();
    expect(provider.metrics(style())).toEqual({ ascent: 11, descent: 3, lineHeight: 19 });
    vi.mocked(ctx.measureText).mockReturnValueOnce({ width: Number.NaN });
    expect(provider.measure("x", style())).toBe(99);
    expect(fallback.measure).toHaveBeenCalled();
  });

  it("returns undefined without a 2D context", () => {
    const { fallback } = setup();
    expect(createCanvasFontMetrics(fallback, () => null)).toBeUndefined();
    expect(createCanvasFontMetrics(fallback)).toBeUndefined();
  });
});
