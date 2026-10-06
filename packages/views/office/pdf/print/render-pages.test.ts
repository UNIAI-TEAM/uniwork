import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfCanvasPage, PdfRenderPageRequest } from "../canvas";
import { inlinePrintImage, PDF_PRINT_DPI, PDF_PRINT_MIN_DPI, renderPdfPrintPages } from "./render-pages";

const A4: PdfCanvasPage = { pageNumber: 1, width: 595, height: 842, rotation: 0 };

function pages(count: number): PdfCanvasPage[] {
  return Array.from({ length: count }, (_, index) => ({ ...A4, pageNumber: index + 1 }));
}

/** A renderer whose PNG grows with the square of the scale, like a real raster. */
function renderer(bytesAtScaleOne = 100) {
  return {
    renderPage: vi.fn(async (request: PdfRenderPageRequest) => {
      const size = Math.max(4, Math.round(bytesAtScaleOne * request.scale * request.scale / 4) * 4);
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
