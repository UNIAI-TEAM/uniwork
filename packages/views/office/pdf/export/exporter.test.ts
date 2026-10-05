import { describe, expect, it, vi } from "vitest";
import type { PdfCanvasPage, PdfPageRenderService, PdfRenderPageRequest } from "../canvas";
import { DEFAULT_PDF_EXPORT_SCALE, exportPdfPages } from "./exporter";
import { PdfExportError, type PdfPageExportFile, type PdfPageExportProgress } from "./types";

const pages: readonly PdfCanvasPage[] = [
  { pageNumber: 1, width: 595, height: 842 },
  { pageNumber: 3, width: 595, height: 842 },
];

function renderer(): PdfPageRenderService {
  return {
    renderPage: vi.fn(async ({ pageNumber, width, height }: PdfRenderPageRequest) => ({ src: `data:image/png;base64,page-${pageNumber}`, width, height })),
  };
}

describe("exportPdfPages", () => {
  it("renders every page in display order at the default scale and saves one PNG per page", async () => {
    const host = renderer();
    const saved: PdfPageExportFile[] = [];
    const progress: PdfPageExportProgress[] = [];

    const files = await exportPdfPages({
      renderer: host,
      pages,
      fileBaseName: "report",
      savePage: (file) => { saved.push(file); },
      onProgress: (next) => { progress.push(next); },
    });

    expect(host.renderPage).toHaveBeenCalledTimes(2);
    expect(host.renderPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ pageNumber: 1, width: 595, height: 842, scale: DEFAULT_PDF_EXPORT_SCALE }));
    expect(host.renderPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageNumber: 3 }));
    expect(saved.map((file) => file.filename)).toEqual(["report-page-1.png", "report-page-3.png"]);
    expect(saved.map((file) => file.result.src)).toEqual(["data:image/png;base64,page-1", "data:image/png;base64,page-3"]);
    expect(progress).toEqual([{ page: 1, total: 2 }, { page: 2, total: 2 }]);
    expect(files).toHaveLength(2);
  });

  it("honours a custom scale and filename stem", async () => {
    const host = renderer();
    await exportPdfPages({ renderer: host, pages: [pages[0] as PdfCanvasPage], scale: 4, savePage: vi.fn() });
    expect(host.renderPage).toHaveBeenCalledWith(expect.objectContaining({ scale: 4 }));
  });

  it("refuses an empty page list", async () => {
    await expect(exportPdfPages({ renderer: renderer(), pages: [] })).rejects.toMatchObject({ code: "no_pages" });
  });

  it("stops before rendering when the run is already cancelled", async () => {
    const host = renderer();
    const controller = new AbortController();
    controller.abort();
    await expect(exportPdfPages({ renderer: host, pages, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(host.renderPage).not.toHaveBeenCalled();
  });

  it("maps an abort during render to cancelled", async () => {
    const controller = new AbortController();
    const host: PdfPageRenderService = {
      renderPage: vi.fn(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    };
    await expect(exportPdfPages({ renderer: host, pages, signal: controller.signal })).rejects.toBeInstanceOf(PdfExportError);
    await expect(exportPdfPages({ renderer: host, pages, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("propagates a renderer failure", async () => {
    const host: PdfPageRenderService = {
      renderPage: vi.fn(async () => {
        throw new Error("engine down");
      }),
    };
    await expect(exportPdfPages({ renderer: host, pages, savePage: vi.fn() })).rejects.toThrow("engine down");
  });
});
