import type { PdfCanvasPage } from "../canvas";
import { PDF_PRINT_IMAGE_BUDGET_BYTES, PdfPrintError, type PdfPrintImageInliner, type PdfPrintPage, type PdfPrintRenderRequest } from "./types";

/** Print resolution of the first pass, in dots per inch. */
export const PDF_PRINT_DPI = 150;
/** Lowest resolution a printout may drop to before the run fails as too large. */
export const PDF_PRINT_MIN_DPI = 72;
/** PDF user space is 72 points per inch, so a render scale of 1 is 72 dpi. */
const POINTS_PER_INCH = 72;
/** A retry aims below the projected size so one more pass is usually enough. */
const RETRY_HEADROOM = 0.85;
/** Every retry drops at least this much, so the ladder always terminates. */
const MAX_RETRY_RATIO = 0.9;

/** Only an inline raster may reach the copy: no SVG, no HTML, no remote URL. */
const INLINE_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isInlinePrintImage(src: string): boolean {
  return INLINE_IMAGE.test(src);
}

function cancelled(): PdfPrintError {
  return new PdfPrintError("cancelled", "PDF print was cancelled");
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("pdf_print_read_failed")));
    reader.onerror = () => reject(reader.error ?? new Error("pdf_print_read_failed"));
    reader.readAsDataURL(blob);
  });
}

/** The default inliner: a `data:` URL passes through (it is validated by the
 * caller), anything else (the web renderer's `blob:` URL) is read into one. */
export const inlinePrintImage: PdfPrintImageInliner = async (src, signal) => {
  if (src.startsWith("data:")) return src;
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error("pdf_print_fetch_failed");
  return readBlob(await response.blob());
};

type PassResult = { kind: "done"; pages: PdfPrintPage[] } | { kind: "over"; projectedBytes: number };

async function renderPass(request: PdfPrintRenderRequest, dpi: number, budget: number): Promise<PassResult> {
  const inline = request.inlineImage ?? inlinePrintImage;
  const total = request.pages.length;
  const pages: PdfPrintPage[] = [];
  let bytes = 0;
  for (const [index, page] of request.pages.entries()) {
    if (request.signal?.aborted) throw cancelled();
    request.onProgress?.({ page: index + 1, total });
    const src = await renderOne(request, page, dpi, inline);
    bytes += src.length;
    pages.push({ pageNumber: page.pageNumber, widthPt: page.width, heightPt: page.height, src });
    // Stop as soon as the pass cannot fit: the rest would be rendered for nothing.
    if (bytes > budget) return { kind: "over", projectedBytes: (bytes / (index + 1)) * total };
  }
  return { kind: "done", pages };
}

async function renderOne(request: PdfPrintRenderRequest, page: PdfCanvasPage, dpi: number, inline: PdfPrintImageInliner): Promise<string> {
  try {
    const result = await request.renderer.renderPage({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      scale: dpi / POINTS_PER_INCH,
      // The scale is already in print dpi: a HiDPI screen must not multiply it.
      pixelRatio: 1,
      signal: request.signal,
    });
    const src = await inline(result.src, request.signal);
    if (!isInlinePrintImage(src)) throw new Error("pdf_print_not_inline_image");
    return src;
  } catch (error) {
    if (request.signal?.aborted) throw cancelled();
    throw new PdfPrintError("render_failed", `Page ${page.pageNumber} did not render: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Render every page for print, inlined as `data:` images. The first pass runs
 * at {@link PDF_PRINT_DPI}; when the images would not fit the byte budget the
 * resolution drops (bytes grow with the square of the dpi) and the pass runs
 * again, down to {@link PDF_PRINT_MIN_DPI}. Past that the run fails with
 * `print_too_large` - never a partial or silently truncated printout.
 */
export async function renderPdfPrintPages(request: PdfPrintRenderRequest): Promise<{ pages: PdfPrintPage[]; dpi: number }> {
  if (request.pages.length === 0) throw new PdfPrintError("no_pages", "PDF print needs at least one page");
  const budget = request.maxImageBytes ?? PDF_PRINT_IMAGE_BUDGET_BYTES;
  let dpi = PDF_PRINT_DPI;
  for (;;) {
    const pass = await renderPass(request, dpi, budget);
    if (pass.kind === "done") return { pages: pass.pages, dpi };
    if (dpi <= PDF_PRINT_MIN_DPI) throw new PdfPrintError("print_too_large", "PDF print copy exceeds the print size limit");
    const fitted = Math.floor(dpi * Math.min(MAX_RETRY_RATIO, Math.sqrt((budget * RETRY_HEADROOM) / pass.projectedBytes)));
    dpi = Math.max(PDF_PRINT_MIN_DPI, fitted);
  }
}
