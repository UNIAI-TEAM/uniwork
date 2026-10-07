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

/** Page 1, already rendered at the pass's dpi, so the pass does not render it again. */
interface FirstPage {
  dpi: number;
  src: string;
}

async function renderPass(request: PdfPrintRenderRequest, dpi: number, budget: number, first: FirstPage | null): Promise<PassResult> {
  const inline = request.inlineImage ?? inlinePrintImage;
  const total = request.pages.length;
  const pages: PdfPrintPage[] = [];
  let bytes = 0;
  let renderedArea = 0;
  for (const [index, page] of request.pages.entries()) {
    if (request.signal?.aborted) throw cancelled();
    const reused = index === 0 && first?.dpi === dpi ? first.src : null;
    if (reused === null) request.onProgress?.({ page: index + 1, total });
    const src = reused ?? await renderOne(request, page, dpi, inline);
    bytes += src.length;
    renderedArea += area(page);
    pages.push({ pageNumber: page.pageNumber, widthPt: page.width, heightPt: page.height, src });
    // Stop as soon as the pass cannot fit: the rest would be rendered for nothing.
    if (bytes > budget) return { kind: "over", projectedBytes: projectByArea(request.pages, bytes, renderedArea, index + 1) };
  }
  return { kind: "done", pages };
}

async function renderOne(request: PdfPrintRenderRequest, page: PdfCanvasPage, dpi: number, inline: PdfPrintImageInliner): Promise<string> {
  let release: (() => void) | undefined;
  try {
    const result = await request.renderer.renderPage({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      scale: dpi / POINTS_PER_INCH,
      // The scale is already in print dpi: a HiDPI screen must not multiply it.
      pixelRatio: 1,
      // A print raster is read once: it must not stay in the viewer's cache.
      cache: false,
      signal: request.signal,
    });
    release = result.release;
    const src = await inline(result.src, request.signal);
    if (!isInlinePrintImage(src)) throw new Error("pdf_print_not_inline_image");
    return src;
  } catch (error) {
    if (request.signal?.aborted) throw cancelled();
    throw new PdfPrintError("render_failed", `Page ${page.pageNumber} did not render: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    release?.();
  }
}

/** The next, lower resolution aimed just under the budget (bytes grow with the
 * square of the dpi); always at least {@link MAX_RETRY_RATIO} lower, never
 * below {@link PDF_PRINT_MIN_DPI}. */
function fittedDpi(dpi: number, projectedBytes: number, budget: number): number {
  const fitted = Math.floor(dpi * Math.min(MAX_RETRY_RATIO, Math.sqrt((budget * RETRY_HEADROOM) / projectedBytes)));
  return Math.max(PDF_PRINT_MIN_DPI, fitted);
}

function area(page: PdfCanvasPage): number {
  return Math.max(0, page.width) * Math.max(0, page.height);
}

/** The whole copy's size from the pages rendered so far: raster bytes grow
 * with the page area, so mixed page sizes are weighed, not counted. `renderedPages`
 * is how many leading pages the bytes cover (the fallback when they have no area). */
function projectByArea(pages: readonly PdfCanvasPage[], renderedBytes: number, renderedArea: number, renderedPages = 0): number {
  if (renderedArea <= 0) return renderedBytes * (pages.length / Math.max(1, renderedPages));
  return (renderedBytes / renderedArea) * pages.reduce((sum, page) => sum + area(page), 0);
}

/**
 * Render every page for print, inlined as `data:` images. Page 1 renders at
 * {@link PDF_PRINT_DPI} first and its bytes per point project the whole copy,
 * which picks the resolution ONCE (bytes grow with the square of the dpi), so
 * the common case renders each page exactly once - on desktop every render
 * ships the document over IPC. Only a real overflow (page 1 was lighter than
 * the rest) drops the resolution again, down to {@link PDF_PRINT_MIN_DPI}. Past
 * that the run fails with `print_too_large` - never a partial or silently
 * truncated printout.
 */
export async function renderPdfPrintPages(request: PdfPrintRenderRequest): Promise<{ pages: PdfPrintPage[]; dpi: number }> {
  if (request.pages.length === 0) throw new PdfPrintError("no_pages", "PDF print needs at least one page");
  const budget = request.maxImageBytes ?? PDF_PRINT_IMAGE_BUDGET_BYTES;
  if (request.signal?.aborted) throw cancelled();
  request.onProgress?.({ page: 1, total: request.pages.length });
  const inline = request.inlineImage ?? inlinePrintImage;
  const first: FirstPage = { dpi: PDF_PRINT_DPI, src: await renderOne(request, request.pages[0]!, PDF_PRINT_DPI, inline) };
  const projected = projectByArea(request.pages, first.src.length, area(request.pages[0]!), 1);
  let dpi = projected > budget ? fittedDpi(PDF_PRINT_DPI, projected, budget) : PDF_PRINT_DPI;
  for (;;) {
    const pass = await renderPass(request, dpi, budget, first);
    if (pass.kind === "done") return { pages: pass.pages, dpi };
    if (dpi <= PDF_PRINT_MIN_DPI) throw new PdfPrintError("print_too_large", "PDF print copy exceeds the print size limit");
    dpi = fittedDpi(dpi, pass.projectedBytes, budget);
  }
}
