import type { PdfRenderResult } from "../canvas";
import { downloadPdfPageFile, pdfPageFileName } from "./download";
import { PdfExportError, type PdfPageExportFile, type PdfPageExportRequest } from "./types";

/** Rasterization scale for exported page images: 2 keeps text legible at
 * print size without exploding the file size of an A4 page. */
export const DEFAULT_PDF_EXPORT_SCALE = 2;

/** Render every page through the host render seam and hand each PNG to the
 * delivery seam in display order. A cancelled run throws; pages already
 * delivered are not rolled back. */
export async function exportPdfPages(request: PdfPageExportRequest): Promise<readonly PdfPageExportFile[]> {
  if (request.pages.length === 0) throw new PdfExportError("no_pages", "PDF export needs at least one page");
  const savePage = request.savePage ?? downloadPdfPageFile;
  const files: PdfPageExportFile[] = [];
  for (let index = 0; index < request.pages.length; index += 1) {
    if (request.signal?.aborted) throw new PdfExportError("cancelled", "PDF export was cancelled");
    const page = request.pages[index];
    if (!page) continue;
    request.onProgress?.({ page: index + 1, total: request.pages.length });
    let result: PdfRenderResult;
    try {
      result = await request.renderer.renderPage({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        scale: request.scale ?? DEFAULT_PDF_EXPORT_SCALE,
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw new PdfExportError("cancelled", "PDF export was cancelled");
      throw error;
    }
    const file: PdfPageExportFile = {
      pageNumber: page.pageNumber,
      filename: pdfPageFileName(request.fileBaseName, page.pageNumber),
      result,
    };
    await savePage(file);
    files.push(file);
  }
  return files;
}
