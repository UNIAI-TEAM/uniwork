import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfCanvasPage, PdfRenderPageRequest } from "../canvas";
import { inlinePrintImage, PDF_PRINT_DPI, PDF_PRINT_MIN_DPI, renderPdfPrintPages } from "./render-pages";

const A4: PdfCanvasPage = { pageNumber: 1, width: 595, height: 842, rotation: 0 };

function pages(count: number): PdfCanvasPage[] {
  return Array.from({ length: count }, (_, index) => ({ ...A4, pageNumber: index + 1 }));
}

/** A renderer whose PNG grows with the page area and the square of the scale, like a real raster. */
function renderer(bytesAtScaleOne = 100) {
  return {
    renderPage: vi.fn(async (request: PdfRenderPageRequest) => {
      const area = (request.width * request.height) / (A4.width * A4.height);
      const size = Math.max(4, Math.round(bytesAtScaleOne * area * request.scale * request.scale / 4) * 4);
      return { src: `data:image/png;base64,${"A".repeat(size)}`, width: request.width * request.scale, height: request.height * request.scale };
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderPdfPrintPages", () => {
  it("renders every page at print resolution and keeps the page size in points", async () => {
    const service = renderer();
    const onProgress = vi.fn();
    const result = await renderPdfPrintPages({ renderer: service, pages: [A4, { pageNumber: 2, width: 842, height: 595, rotation: 0 }], onProgress });

    expect(result.dpi).toBe(PDF_PRINT_DPI);
    expect(PDF_PRINT_DPI).toBeGreaterThanOrEqual(150);
    expect(service.renderPage).toHaveBeenCalledTimes(2);
    expect(service.renderPage.mock.calls[0]?.[0]).toMatchObject({ pageNumber: 1, width: 595, height: 842, scale: 150 / 72 });
    expect(result.pages.map((page) => [page.pageNumber, page.widthPt, page.heightPt])).toEqual([[1, 595, 842], [2, 842, 595]]);
    expect(onProgress).toHaveBeenLastCalledWith({ page: 2, total: 2 });
  });

  it("asks for device-independent pixels so a HiDPI renderer prints at dpi / 72 times the page size", async () => {
    // A renderer that applies the display density the way the web session does.
    const devicePixelRatio = 3;
    const service = {
      renderPage: vi.fn(async (request: PdfRenderPageRequest) => {
        const ratio = request.pixelRatio ?? devicePixelRatio;
        return { src: "data:image/png;base64,AAAA", width: Math.round(request.width * request.scale * ratio), height: Math.round(request.height * request.scale * ratio) };
      }),
    };
    const inlineImage = vi.fn(async (src: string) => src);
    await renderPdfPrintPages({ renderer: service, pages: [A4], inlineImage });

    const request = service.renderPage.mock.calls[0]?.[0];
    expect(request?.pixelRatio).toBe(1);
    const raster = await service.renderPage.mock.results[0]?.value;
    expect(raster.width).toBe(Math.round((595 * PDF_PRINT_DPI) / 72));
    expect(raster.height).toBe(Math.round((842 * PDF_PRINT_DPI) / 72));
  });

  it("inlines a host URL through the inliner before it reaches the copy", async () => {
    const service = { renderPage: vi.fn(async () => ({ src: "blob:https://app.test/1", width: 1, height: 1 })) };
    const inlineImage = vi.fn(async () => "data:image/png;base64,AAAA");
    const result = await renderPdfPrintPages({ renderer: service, pages: [A4], inlineImage });

    expect(inlineImage).toHaveBeenCalledWith("blob:https://app.test/1", undefined);
    expect(result.pages[0]?.src).toBe("data:image/png;base64,AAAA");
  });

  it("lowers the resolution when the copy would exceed the budget, and keeps every page", async () => {
    const service = renderer(1000);
    // At 150 dpi a page is ~4340 bytes; ten pages cannot fit 20 000.
    const result = await renderPdfPrintPages({ renderer: service, pages: pages(10), maxImageBytes: 20_000 });

    expect(result.dpi).toBeLessThan(PDF_PRINT_DPI);
    expect(result.dpi).toBeGreaterThanOrEqual(PDF_PRINT_MIN_DPI);
    expect(result.pages).toHaveLength(10);
    expect(result.pages.reduce((sum, page) => sum + page.src.length, 0)).toBeLessThanOrEqual(20_000);
    // Page 1 at 150 dpi picks the resolution once; then one pass over all ten.
    expect(service.renderPage).toHaveBeenCalledTimes(11);
  });

  it("renders an N-page document exactly N times when it fits at the first resolution", async () => {
    const service = renderer();
    const result = await renderPdfPrintPages({ renderer: service, pages: pages(12) });

    expect(result.dpi).toBe(PDF_PRINT_DPI);
    expect(service.renderPage).toHaveBeenCalledTimes(12);
    expect(service.renderPage.mock.calls.map((call) => call[0].pageNumber)).toEqual(pages(12).map((page) => page.pageNumber));
  });

  it("projects the whole document from page 1 by area, so mixed page sizes pick one resolution up front", async () => {
    const service = renderer(1000);
    // Page 2 has four times the area of page 1: the projection must weigh it.
    const big: PdfCanvasPage = { pageNumber: 2, width: 1190, height: 1684, rotation: 0 };
    const result = await renderPdfPrintPages({ renderer: service, pages: [A4, big], maxImageBytes: 15_000 });

    expect(result.dpi).toBeLessThan(PDF_PRINT_DPI);
    expect(service.renderPage).toHaveBeenCalledTimes(3);
  });

  it("retries lower only on a real overflow the projection from page 1 missed", async () => {
    // Page 1 is nearly blank; the rest are dense, so the first pass really overflows.
    const service = { renderPage: vi.fn(async (request: PdfRenderPageRequest) => {
      const perScale = request.pageNumber === 1 ? 10 : 1000;
      const size = Math.max(4, Math.round(perScale * request.scale * request.scale / 4) * 4);
      return { src: `data:image/png;base64,${"A".repeat(size)}`, width: 1, height: 1 };
    }) };
    const result = await renderPdfPrintPages({ renderer: service, pages: pages(10), maxImageBytes: 20_000 });

    expect(result.dpi).toBeLessThan(PDF_PRINT_DPI);
    expect(result.pages.reduce((sum, page) => sum + page.src.length, 0)).toBeLessThanOrEqual(20_000);
  });

  it("weighs a mid-pass overflow by page area, so mixed sizes settle in one more pass", async () => {
    // Page 1 is nearly blank; the dense pages after it include two large sheets.
    const huge = (pageNumber: number): PdfCanvasPage => ({ pageNumber, width: 1190, height: 1684, rotation: 0 });
    const service = { renderPage: vi.fn(async (request: PdfRenderPageRequest) => {
      const area = (request.width * request.height) / (A4.width * A4.height);
      const perScale = request.pageNumber === 1 ? 10 : 1000;
      const size = Math.max(4, Math.round(perScale * area * request.scale * request.scale / 4) * 4);
      return { src: `data:image/png;base64,${"A".repeat(size)}`, width: 1, height: 1 };
    }) };
    const result = await renderPdfPrintPages({ renderer: service, pages: [A4, { ...A4, pageNumber: 2 }, huge(3), huge(4)], maxImageBytes: 20_000 });

    expect(result.pages.reduce((sum, page) => sum + page.src.length, 0)).toBeLessThanOrEqual(20_000);
    // Page 1 probe + the 150 dpi pass that overflows at page 3 (pages 2 and 3) + one pass of 4.
    expect(service.renderPage).toHaveBeenCalledTimes(7);
  });

  it("asks for an uncached render and releases what the host handed over once it is inlined", async () => {
    const release = vi.fn();
    const inlineImage = vi.fn(async () => "data:image/png;base64,AAAA");
    const service = { renderPage: vi.fn(async () => ({ src: "blob:https://app.test/1", width: 1, height: 1, release })) };
    await renderPdfPrintPages({ renderer: service, pages: pages(2), inlineImage });

    expect(service.renderPage.mock.calls.every((call) => (call as unknown as [PdfRenderPageRequest])[0].cache === false)).toBe(true);
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.invocationCallOrder[0]).toBeGreaterThan(inlineImage.mock.invocationCallOrder[0]!);
  });

  it("releases the host resource even when inlining fails", async () => {
    const release = vi.fn();
    const service = { renderPage: vi.fn(async () => ({ src: "blob:https://app.test/1", width: 1, height: 1, release })) };
    const inlineImage = vi.fn(async () => { throw new Error("pdf_print_fetch_failed"); });
    await expect(renderPdfPrintPages({ renderer: service, pages: [A4], inlineImage })).rejects.toMatchObject({ code: "render_failed" });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fails as print_too_large past the resolution floor instead of printing part of the document", async () => {
    const service = renderer(100_000);
    await expect(renderPdfPrintPages({ renderer: service, pages: pages(3), maxImageBytes: 50_000 })).rejects.toMatchObject({ code: "print_too_large" });
    const scales = service.renderPage.mock.calls.map((call) => call[0].scale);
    expect(Math.min(...scales)).toBeCloseTo(PDF_PRINT_MIN_DPI / 72);
  });

  it("fails the run as render_failed when one page does not render", async () => {
    const service = { renderPage: vi.fn(async (request: PdfRenderPageRequest) => {
      if (request.pageNumber === 2) throw new Error("pdf_render_failed");
      return { src: "data:image/png;base64,AAAA", width: 1, height: 1 };
    }) };
    await expect(renderPdfPrintPages({ renderer: service, pages: pages(3) })).rejects.toMatchObject({ code: "render_failed" });
    expect(service.renderPage).toHaveBeenCalledTimes(2);
  });

  it("fails as render_failed when the renderer answers something that is not an inline raster", async () => {
    const service = { renderPage: vi.fn(async () => ({ src: "data:image/svg+xml;base64,PHN2Zz4=", width: 1, height: 1 })) };
    await expect(renderPdfPrintPages({ renderer: service, pages: [A4] })).rejects.toMatchObject({ code: "render_failed" });
  });

  it("refuses an empty document and stops on abort", async () => {
    await expect(renderPdfPrintPages({ renderer: renderer(), pages: [] })).rejects.toMatchObject({ code: "no_pages" });
    const controller = new AbortController();
    controller.abort();
    await expect(renderPdfPrintPages({ renderer: renderer(), pages: [A4], signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("inlinePrintImage", () => {
  it("passes a data: URL through without fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(inlinePrintImage("data:image/png;base64,AAAA")).resolves.toBe("data:image/png;base64,AAAA");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a blob: URL into a data: URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) })));
    await expect(inlinePrintImage("blob:https://app.test/1")).resolves.toBe("data:image/png;base64,AQID");
  });

  it("rejects a URL that does not load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await expect(inlinePrintImage("blob:https://app.test/1")).rejects.toThrow("pdf_print_fetch_failed");
  });
});
