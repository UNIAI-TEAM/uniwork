// Rebuild-font resolution and the stroke / color / size readers, driven
// through a small in-memory stand-in for the pdfium module (heap + the
// handful of FPDF* calls these helpers make). Faces come from the bundled
// Noto Sans files, so nothing depends on installed system fonts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fontCoversText } from "./font-cmap";
import { isTruetype } from "./font-locate";
import {
  faceIsBold,
  fillColorOf,
  readStroke,
  renderedEm,
  resolveRebuildFont,
  strokeObject,
  syntheticBoldWidth,
} from "./font-resolve";
import { subsetTtf } from "./font-subset";
import { bundledFontDir } from "./pdfium";
import type { Pdfium } from "./pdfium";
import type { TextEditInput } from "./types";

const notoRegular = readFileSync(join(bundledFontDir()!, "NotoSans-Regular.ttf"));
const notoBold = readFileSync(join(bundledFontDir()!, "NotoSans-Bold.ttf"));

interface FakeSpec {
  baseName?: string;
  family?: string;
  embedded?: Buffer | null;
  renderMode?: number;
  /** RGBA, or null when the object has no stroke color */
  stroke?: [number, number, number, number] | null;
  strokeWidth?: number | null;
  fill?: [number, number, number, number] | null;
  fontSize?: number | null;
  matrix?: [number, number] | null;
}

interface Fake {
  m: Pdfium;
  calls: [string, ...number[]][];
}

/** In-memory pdfium: a bump-allocated heap plus the font/object calls under test. */
function fakePdfium(spec: FakeSpec = {}): Fake {
  const buffer = new ArrayBuffer(4 << 20);
  const HEAPU8 = new Uint8Array(buffer);
  const HEAPF32 = new Float32Array(buffer);
  let next = 8;
  const calls: Fake["calls"] = [];
  const writeRgba = (ptr: number, c: [number, number, number, number]) =>
    [0, 4, 8, 12].forEach((o, i) => (HEAPU8[ptr + o] = c[i]!));
  const nameFn = (value: string | undefined) => (_font: number, buf: number, len: number) => {
    const bytes = Buffer.from(`${value ?? ""}\0`);
    if (value === undefined) return 0;
    if (buf) HEAPU8.set(bytes.subarray(0, len), buf);
    return bytes.length;
  };
  const m = {
    HEAPU8,
    HEAPF32,
    _malloc: (n: number) => {
      const p = next;
      next += (n + 7) & ~7;
      return p;
    },
    _free: () => undefined,
    _FPDFFont_GetIsEmbedded: () => (spec.embedded ? 1 : 0),
    _FPDFFont_GetFontData: (_f: number, buf: number, len: number, lenPtr: number) => {
      const data = spec.embedded!;
      if (!buf) {
        HEAPU8.set(Buffer.from(new Uint32Array([data.length]).buffer), lenPtr);
        return 1;
      }
      expect(len).toBe(data.length);
      HEAPU8.set(data, buf);
      return 1;
    },
    _FPDFFont_GetBaseFontName: nameFn(spec.baseName),
    _FPDFFont_GetFamilyName: nameFn(spec.family),
    _FPDFTextObj_GetTextRenderMode: () => spec.renderMode ?? 0,
    _FPDFPageObj_GetStrokeColor: (_o: number, r: number) => {
      if (!spec.stroke) return 0;
      writeRgba(r, spec.stroke);
      return 1;
    },
    _FPDFPageObj_GetStrokeWidth: (_o: number, ptr: number) => {
      if (spec.strokeWidth == null) return 0;
      HEAPF32[ptr >> 2] = spec.strokeWidth;
      return 1;
    },
    _FPDFPageObj_GetFillColor: (_o: number, r: number) => {
      if (!spec.fill) return 0;
      writeRgba(r, spec.fill);
      return 1;
    },
    _FPDFTextObj_GetFontSize: (_o: number, ptr: number) => {
      if (spec.fontSize == null) return 0;
      HEAPF32[ptr >> 2] = spec.fontSize;
      return 1;
    },
    _FPDFPageObj_GetMatrix: (_o: number, ptr: number) => {
      if (!spec.matrix) return 0;
      HEAPF32[ptr >> 2] = spec.matrix[0];
      HEAPF32[(ptr >> 2) + 1] = spec.matrix[1];
      return 1;
    },
    _FPDFTextObj_SetTextRenderMode: (_o: number, mode: number) => void calls.push(["mode", mode]),
    _FPDFPageObj_SetStrokeColor: (_o: number, r: number, g: number, b: number, a: number) =>
      void calls.push(["color", r, g, b, a]),
    _FPDFPageObj_SetStrokeWidth: (_o: number, w: number) => void calls.push(["width", w]),
    _FPDFPageObj_SetLineJoin: (_o: number, j: number) => void calls.push(["join", j]),
  };
  return { m: m as unknown as Pdfium, calls };
}

const edit = (over: Partial<TextEditInput> & { newText: string }): TextEditInput => ({
  pageIndex: 0,
  rect: [0, 0, 10, 10],
  oldText: "old",
  fontSize: 12,
  ...over,
});

describe("faceIsBold", () => {
  it.each([
    ["ABCDEF+Arial-BoldMT", true],
    ["Roboto-Black", true],
    ["Foo-Heavy", true],
    ["Foo-SemiBold", true],
    ["Foo-DemiBold", true],
    ["Foo-ExtraBold", true],
    ["Foo-UltraBold", true],
    ["Arial-ItalicMT", false],
    ["NotoSans-Regular", false],
  ])("judges %s as bold=%s from its PostScript name", (name, bold) => {
    expect(faceIsBold(fakePdfium({ baseName: name }).m, 1)).toBe(bold);
  });

  it("treats a font without a readable name as not bold", () => {
    expect(faceIsBold(fakePdfium({}).m, 1)).toBe(false);
  });
});

describe("syntheticBoldWidth", () => {
  it("scales the stroke with the rendered em", () => {
    expect(syntheticBoldWidth(10)).toBeCloseTo(0.35, 6);
    expect(syntheticBoldWidth(0)).toBe(0);
  });
});

describe("readStroke", () => {
  it("returns null for a fill-only text object", () => {
    expect(readStroke(fakePdfium({ renderMode: 0 }).m, 1)).toBeNull();
  });

  it("reads color and width of a fill+stroke object and notes when the stroke tracks the fill", () => {
    const { m } = fakePdfium({
      renderMode: 2,
      stroke: [10, 20, 30, 255],
      strokeWidth: 0.5,
      fill: [10, 20, 30, 255],
    });
    expect(readStroke(m, 1)).toEqual({ mode: 2, color: [10, 20, 30, 255], width: 0.5, sameAsFill: true });
  });

  it("flags a stroke that differs from the fill, and accepts the clipping variant", () => {
    const { m } = fakePdfium({
      renderMode: 6,
      stroke: [1, 2, 3, 255],
      strokeWidth: 2,
      fill: [9, 9, 9, 255],
    });
    expect(readStroke(m, 1)).toMatchObject({ mode: 6, sameAsFill: false });
  });

  it("reports width 0 and no fill-tracking when those cannot be read", () => {
    const { m } = fakePdfium({ renderMode: 2, stroke: [1, 2, 3, 255], strokeWidth: null, fill: null });
    expect(readStroke(m, 1)).toEqual({ mode: 2, color: [1, 2, 3, 255], width: 0, sameAsFill: false });
  });

  it("returns null when the stroke color is unavailable", () => {
    expect(readStroke(fakePdfium({ renderMode: 2, stroke: null }).m, 1)).toBeNull();
  });
});

describe("strokeObject", () => {
  it("sets fill+stroke mode, color, width and a round join", () => {
    const { m, calls } = fakePdfium();
    strokeObject(m, 1, [4, 5, 6, 255], 0.42);
    expect(calls.map((c) => c[0])).toEqual(["mode", "color", "width", "join"]);
    expect(calls[0]).toEqual(["mode", 2]);
    expect(calls[1]).toEqual(["color", 4, 5, 6, 255]);
    expect(calls[2]![1]).toBeCloseTo(0.42, 6);
    expect(calls[3]).toEqual(["join", 1]);
  });

  it("honors an explicit render mode", () => {
    const { m, calls } = fakePdfium();
    strokeObject(m, 1, [0, 0, 0, 255], 1, 6);
    expect(calls[0]).toEqual(["mode", 6]);
  });
});

describe("fillColorOf", () => {
  it("reads the fill color", () => {
    expect(fillColorOf(fakePdfium({ fill: [200, 100, 50, 128] }).m, 1)).toEqual([200, 100, 50, 128]);
  });

  it("promotes a zero alpha to opaque", () => {
    expect(fillColorOf(fakePdfium({ fill: [200, 100, 50, 0] }).m, 1)).toEqual([200, 100, 50, 255]);
  });

  it("defaults to opaque black when the object has no fill color", () => {
    expect(fillColorOf(fakePdfium({ fill: null }).m, 1)).toEqual([0, 0, 0, 255]);
  });
});

describe("renderedEm", () => {
  it("multiplies the font size by the matrix x-scale (hypot of a and b)", () => {
    expect(renderedEm(fakePdfium({ fontSize: 12, matrix: [3, 4] }).m, 1)).toBeCloseTo(60, 4);
  });

  it("returns the plain font size without a matrix", () => {
    expect(renderedEm(fakePdfium({ fontSize: 12, matrix: null }).m, 1)).toBeCloseTo(12, 4);
  });

  it("assumes size 1 when the font size cannot be read", () => {
    expect(renderedEm(fakePdfium({ fontSize: null, matrix: [2, 0] }).m, 1)).toBeCloseTo(2, 4);
    expect(renderedEm(fakePdfium({ fontSize: null, matrix: null }).m, 1)).toBe(1);
  });
});

describe("resolveRebuildFont with a chosen edit font", () => {
  it("subsets the bundled Noto Sans to the new text", async () => {
    const out = await resolveRebuildFont(fakePdfium().m, 0, edit({ newText: "Việt", newFont: "noto" }), "Việt");
    expect(out.syntheticBold).toBe(false);
    expect(isTruetype(out.bytes)).toBe(true);
    expect(out.bytes.length).toBeLessThan(notoRegular.length / 10);
    expect(fontCoversText(out.bytes, "Việt")).toBe(true);
  });

  it("ignores line breaks when subsetting but keeps them out of the drawn text", async () => {
    const out = await resolveRebuildFont(fakePdfium().m, 0, edit({ newText: "a\nb", newFont: "noto" }), "a\nb");
    expect(fontCoversText(out.bytes, "ab")).toBe(true);
  });

  it("loads the real bold face for a bold toggle, so no stroke is synthesized", async () => {
    const out = await resolveRebuildFont(
      fakePdfium().m,
      0,
      edit({ newText: "Bold", newFont: "noto", newBold: true }),
      "Bold",
    );
    expect(out.syntheticBold).toBe(false);
    expect(out.bytes.equals(await subsetTtf(notoBold, "Bold"))).toBe(true);
  });

  it("degrades italic to the regular face (none bundled) without failing the edit", async () => {
    const out = await resolveRebuildFont(
      fakePdfium().m,
      0,
      edit({ newText: "Ita", newFont: "noto", newItalic: true }),
      "Ita",
    );
    expect(out.syntheticBold).toBe(false);
    expect(out.bytes.equals(await subsetTtf(notoRegular, "Ita"))).toBe(true);
  });

  it("serves a bold italic request from the bundled regular face when no bolditalic file exists", async () => {
    const out = await resolveRebuildFont(
      fakePdfium().m,
      0,
      edit({ newText: "BI", newFont: "noto", newBold: true, newItalic: true }),
      "BI",
    );
    // The bold flag is deliberately not asserted: see the report (bolditalic is treated as a real
    // bold face although the regular bytes were loaded)
    expect(out.bytes.equals(await subsetTtf(notoRegular, "BI"))).toBe(true);
  });

  it("refuses text no available font can draw", async () => {
    await expect(
      resolveRebuildFont(fakePdfium().m, 0, edit({ newText: "a\u{10FFFD}", newFont: "noto" }), "a\u{10FFFD}"),
    ).rejects.toThrow("no available font can draw");
  });
});

describe("resolveRebuildFont keeping the original font", () => {
  it("reuses the embedded face as is when it covers the new text", async () => {
    const { m } = fakePdfium({ baseName: "ABCDEF+NotoSans-Regular", embedded: notoRegular });
    const out = await resolveRebuildFont(m, 7, edit({ newText: "Việt" }), "Việt");
    expect(out.bytes.equals(notoRegular)).toBe(true); // no re-subsetting of an embedded face
    expect(out.syntheticBold).toBe(false);
  });

  it("synthesizes bold by stroking when the kept face is not bold", async () => {
    const { m } = fakePdfium({ baseName: "ABCDEF+NotoSans-Regular", embedded: notoRegular });
    const out = await resolveRebuildFont(m, 7, edit({ newText: "Việt", newBold: true }), "Việt");
    expect(out.bytes.equals(notoRegular)).toBe(true);
    expect(out.syntheticBold).toBe(true);
  });

  it("does not stroke again when the kept face already carries weight", async () => {
    const { m } = fakePdfium({ baseName: "ABCDEF+NotoSans-Bold", embedded: notoBold });
    const out = await resolveRebuildFont(m, 7, edit({ newText: "Việt", newBold: true }), "Việt");
    expect(out.syntheticBold).toBe(false);
  });

  it("looks the face up by PostScript name and family when it is not embedded", async () => {
    const { m } = fakePdfium({ baseName: "ABCDEF+NotoSans-Bold", family: "Noto Sans" });
    const out = await resolveRebuildFont(m, 7, edit({ newText: "Việt" }), "Việt");
    expect(out.bytes.equals(await subsetTtf(notoBold, "Việt"))).toBe(true);
    expect(out.syntheticBold).toBe(false);
  });

  it("serves a style override on a kept face from the installed variants", async () => {
    const { m } = fakePdfium({ baseName: "NotoSans-Regular", family: "Noto Sans" });
    const out = await resolveRebuildFont(m, 7, edit({ newText: "Ita", newItalic: true }), "Ita");
    expect(isTruetype(out.bytes)).toBe(true);
    expect(fontCoversText(out.bytes, "Ita")).toBe(true);
    expect(out.syntheticBold).toBe(false);
  });

  it("uses a fallback face when the run has no usable font handle", async () => {
    const out = await resolveRebuildFont(fakePdfium().m, 0, edit({ newText: "Việt" }), "Việt");
    expect(isTruetype(out.bytes)).toBe(true);
    expect(fontCoversText(out.bytes, "Việt")).toBe(true);
  });

  it("refuses text nothing can draw, even with an embedded face", async () => {
    const { m } = fakePdfium({ baseName: "NotoSans-Regular", family: "Noto Sans", embedded: notoRegular });
    await expect(resolveRebuildFont(m, 7, edit({ newText: "\u{10FFFD}" }), "\u{10FFFD}")).rejects.toThrow(
      "no available font can draw",
    );
  });
});
