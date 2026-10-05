import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import { applyPdfOpsInBrowser } from "./pdf";
import { BrowserPdfOpenError, createBrowserPdfium, loadBrowserPdfium, type BrowserPdfiumModule } from "./pdfium";

const wasm = readFileSync(createRequire(import.meta.url).resolve("@embedpdf/pdfium/pdfium.wasm"));

function wasmFetch(): typeof fetch {
  const body = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
  return vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
}

async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([200, 100]).drawText("Hello pdfium", { x: 10, y: 50, size: 14, font });
  doc.addPage([100, 200]);
  return doc.save();
}

/** A 100x200 portrait page with one text line, optionally carrying a /Rotate. */
async function rotatedTextPdf(rotation: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([100, 200]);
  if (rotation !== 0) page.setRotation(degrees(rotation));
  page.drawText("Rotated text", { x: 10, y: 150, size: 14, font });
  return doc.save();
}

const nonWhite = (data: Uint8ClampedArray): number => {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) n++;
  return n;
};

describe("loadBrowserPdfium (real wasm)", () => {
  it("shares one instance per URL and renders pages, annotations and text", async () => {
    const fetchSpy = wasmFetch();
    const [a, b] = await Promise.all([
      loadBrowserPdfium({ wasmUrl: "/real.wasm", fetch: fetchSpy }),
      loadBrowserPdfium({ wasmUrl: "/real.wasm", fetch: fetchSpy }),
    ]);
    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const bytes = await textPdf();
    const doc = a.openDocument(bytes);
    try {
      expect(doc.pageCount).toBe(2);
      expect(doc.pageSize(0)).toEqual({ width: 200, height: 100 });
      expect(doc.pageSize(1)).toEqual({ width: 100, height: 200 });
      expect(doc.pageText(0)).toContain("Hello pdfium");

      const page = doc.renderPage(0, { scale: 1.5 });
      expect([page.width, page.height]).toEqual([300, 150]);
      expect(page.data).toBeInstanceOf(Uint8ClampedArray);
      expect(page.data.length).toBe(300 * 150 * 4);
      expect(page.data[3]).toBe(255);
      expect(nonWhite(page.data)).toBeGreaterThan(20);
    } finally {
      doc.close();
    }

    // A freshly added highlight must be visible (FPDF_ANNOT).
    const edited = await applyPdfOpsInBrowser(bytes, [
      { op: "addMarkup", attributes: { markup: { pageIndex: 0, type: "highlight", color: [1, 0.8, 0], quads: [[10, 70, 150, 70, 10, 40, 150, 40]] } } },
    ]);
    const withAnnot = a.openDocument(edited.bytes);
    const plain = a.openDocument(bytes);
    try {
      expect(nonWhite(withAnnot.renderPage(0, { scale: 1 }).data)).toBeGreaterThan(nonWhite(plain.renderPage(0, { scale: 1 }).data) + 1000);
    } finally {
      withAnnot.close();
      plain.close();
    }
  });

  it("returns one top-left char box per pageText character with non-negative sizes", async () => {
    const pdfium = await loadBrowserPdfium({ wasmUrl: "/boxes.wasm", fetch: wasmFetch() });
    const bytes = await textPdf();
    const doc = pdfium.openDocument(bytes);
    try {
      const text = doc.pageText(0);
      const boxes = doc.pageCharBoxes(0);
      expect(boxes).toHaveLength(text.length);
      for (const box of boxes) {
        expect(Number.isFinite(box.x)).toBe(true);
        expect(Number.isFinite(box.y)).toBe(true);
        expect(box.width).toBeGreaterThanOrEqual(0);
        expect(box.height).toBeGreaterThanOrEqual(0);
      }
      // "Hello pdfium" has real glyphs: most boxes carry a positive width.
      expect(boxes.filter((box) => box.width > 0).length).toBeGreaterThan(3);
    } finally {
      doc.close();
    }
  });

  it("reports char boxes in the page's display space so a find hit paints on rotated text", async () => {
    const pdfium = await loadBrowserPdfium({ wasmUrl: "/rot-display.wasm", fetch: wasmFetch() });
    const plain = pdfium.openDocument(await rotatedTextPdf(0));
    const rotated = pdfium.openDocument(await rotatedTextPdf(90));
    try {
      // The line is drawn near the top-left of the 100x200 page at /Rotate 0.
      const plainBoxes = plain.pageCharBoxes(0).filter((box) => box.width > 0);
      expect(plainBoxes.length).toBeGreaterThan(3);
      expect(Math.min(...plainBoxes.map((box) => box.x))).toBeLessThan(50);
      for (const box of plainBoxes) {
        expect(box.x + box.width).toBeLessThanOrEqual(100.01);
        expect(box.y + box.height).toBeLessThanOrEqual(200.01);
      }

      // /Rotate 90 swaps the display box to 200x100. The same line must land
      // near the RIGHT edge of the display box (the unrotated left edge becomes
      // the display top, the unrotated top becomes the display right), so its x
      // is past the 100-point midline - proving the /Rotate transform moved the
      // coordinates instead of leaving them in the unrotated box.
      const rotatedBoxes = rotated.pageCharBoxes(0).filter((box) => box.width > 0);
      expect(rotatedBoxes.length).toBeGreaterThan(3);
      expect(Math.min(...rotatedBoxes.map((box) => box.x))).toBeGreaterThan(100);
      for (const box of rotatedBoxes) {
        expect(box.x).toBeGreaterThanOrEqual(-0.01);
        expect(box.y).toBeGreaterThanOrEqual(-0.01);
        expect(box.x + box.width).toBeLessThanOrEqual(200.01);
        expect(box.y + box.height).toBeLessThanOrEqual(100.01);
      }
      expect(plain.pageText(0)).toContain("Rotated text");
      expect(rotated.pageText(0)).toContain("Rotated text");
    } finally {
      plain.close();
      rotated.close();
    }
  });

  it("reports engine_error for bytes that are not a PDF", async () => {
    const pdfium = await loadBrowserPdfium({ wasmUrl: "/real.wasm", fetch: wasmFetch() });
    expect(() => pdfium.openDocument(new TextEncoder().encode("not a pdf"))).toThrowError(
      expect.objectContaining({ name: "BrowserPdfOpenError", code: "engine_error" }),
    );
  });

  it("does not cache a failed load", async () => {
    const bad = vi.fn(async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    await expect(loadBrowserPdfium({ wasmUrl: "/missing.wasm", fetch: bad })).rejects.toThrow(/404/);
    await expect(loadBrowserPdfium({ wasmUrl: "/missing.wasm", fetch: bad })).rejects.toThrow(/404/);
    expect(bad).toHaveBeenCalledTimes(2);
  });
});

/** A fake module whose document load fails with a chosen FPDF error. */
function failingModule(error: number): BrowserPdfiumModule {
  return {
    HEAPU8: new Uint8Array(1024),
    _malloc: () => 16,
    _free: () => undefined,
    _PDFiumExt_Init: () => undefined,
    _FPDF_LoadMemDocument: () => 0,
    _FPDF_GetLastError: () => error,
    _FPDF_CloseDocument: () => undefined,
    _FPDF_LoadPage: () => 0,
    _FPDF_ClosePage: () => undefined,
    _FPDF_GetPageCount: () => 0,
    _FPDF_GetPageWidthF: () => 0,
    _FPDF_GetPageHeightF: () => 0,
    _FPDFPage_GetRotation: () => 0,
    _FPDFBitmap_CreateEx: () => 0,
    _FPDFBitmap_FillRect: () => undefined,
    _FPDFBitmap_Destroy: () => undefined,
    _FPDF_RenderPageBitmap: () => undefined,
    _FPDFText_LoadPage: () => 0,
    _FPDFText_ClosePage: () => undefined,
    _FPDFText_CountChars: () => 0,
    _FPDFText_GetText: () => 0,
    _FPDFText_GetLooseCharBox: () => 0,
    _FPDFText_GetCharOrigin: () => 0,
    HEAPF32: new Float32Array(64),
    HEAPF64: new Float64Array(64),
  };
}

/** A fake whose one page is the text "ab": char 0 has a box, char 1 has none. */
function boxModule(): BrowserPdfiumModule {
  let bump = 0x100;
  const m: BrowserPdfiumModule = {
    HEAPU8: new Uint8Array(4096),
    HEAPF32: new Float32Array(1024),
    HEAPF64: new Float64Array(1024),
    _malloc: (size) => {
      const ptr = bump;
      bump += Math.max(16, size + 8);
      return ptr;
    },
    _free: () => undefined,
    _PDFiumExt_Init: () => undefined,
    _FPDF_LoadMemDocument: () => 1,
    _FPDF_GetLastError: () => 0,
    _FPDF_CloseDocument: () => undefined,
    _FPDF_LoadPage: () => 1,
    _FPDF_ClosePage: () => undefined,
    _FPDF_GetPageCount: () => 1,
    _FPDF_GetPageWidthF: () => 100,
    _FPDF_GetPageHeightF: () => 100,
    _FPDFPage_GetRotation: () => 0,
    _FPDFBitmap_CreateEx: () => 0,
    _FPDFBitmap_FillRect: () => undefined,
    _FPDFBitmap_Destroy: () => undefined,
    _FPDF_RenderPageBitmap: () => undefined,
    _FPDFText_LoadPage: () => 1,
    _FPDFText_ClosePage: () => undefined,
    _FPDFText_CountChars: () => 2,
    _FPDFText_GetText: (_tp, _start, count, buffer) => {
      // "ab" as UTF-16LE, plus the trailing NUL: written = count + 1.
      m.HEAPU8[buffer] = 97;
      m.HEAPU8[buffer + 2] = 98;
      return count + 1;
    },
    _FPDFText_GetLooseCharBox: (_tp, index, rect) => {
      if (index !== 0) return 0;
      // FS_RECTF: left, top, right, bottom.
      m.HEAPF32[rect >> 2] = 10;
      m.HEAPF32[(rect >> 2) + 1] = 30;
      m.HEAPF32[(rect >> 2) + 2] = 20;
      m.HEAPF32[(rect >> 2) + 3] = 20;
      return 1;
    },
    _FPDFText_GetCharOrigin: (_tp, _index, x, y) => {
      m.HEAPF64[x >> 3] = 5;
      m.HEAPF64[y >> 3] = 25;
      return 1;
    },
  };
  return m;
}

describe("createBrowserPdfium (fake module)", () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);

  it("maps the password error by whether a password was supplied", () => {
    const pdfium = createBrowserPdfium(failingModule(4));
    expect(() => pdfium.openDocument(bytes)).toThrowError(expect.objectContaining({ code: "password_required" }));
    expect(() => pdfium.openDocument(bytes, "pw")).toThrowError(expect.objectContaining({ code: "wrong_password" }));
    expect(() => pdfium.openDocument(bytes)).toThrow(BrowserPdfOpenError);
  });

  it("maps every other load error to engine_error", () => {
    expect(() => createBrowserPdfium(failingModule(3)).openDocument(bytes)).toThrowError(expect.objectContaining({ code: "engine_error" }));
  });

  it("maps unrotated char boxes into the page's DISPLAY space on a /Rotate 90 page", () => {
    // A 90-degree page reports a display size of 200x100, so its unrotated box is
    // 100x200. The char box is reported in unrotated bottom-left space
    // (left 10, top 30, right 20, bottom 20) -> unrotated top-left (10, 170, 10x10)
    // -> display top-left (20, 10, 10x10): x = unrotatedHeight - y - height.
    const m = boxModule();
    m._FPDF_GetPageWidthF = () => 200;
    m._FPDF_GetPageHeightF = () => 100;
    m._FPDFPage_GetRotation = () => 1;
    const doc = createBrowserPdfium(m).openDocument(bytes);
    try {
      expect(doc.pageCharBoxes(0)).toEqual([
        { x: 20, y: 10, width: 10, height: 10 },
        { x: 25, y: 5, width: 0, height: 0 },
      ]);
    } finally {
      doc.close();
    }
  });

  it("keeps offsets aligned: a char with no box becomes a zero-size box", () => {
    const doc = createBrowserPdfium(boxModule()).openDocument(bytes);
    try {
      expect(doc.pageText(0)).toBe("ab");
      expect(doc.pageCharBoxes(0)).toEqual([
        { x: 10, y: 70, width: 10, height: 10 },
        { x: 5, y: 75, width: 0, height: 0 },
      ]);
    } finally {
      doc.close();
    }
  });

  it("refuses calls after close", () => {
    const m = failingModule(0);
    m._FPDF_LoadMemDocument = () => 99;
    m._FPDF_GetPageCount = () => 1;
    const doc = createBrowserPdfium(m).openDocument(bytes);
    doc.close();
    doc.close();
    expect(() => doc.pageSize(0)).toThrow(/closed/);
  });
});
