import { printPageFromCopy, type OfficePrintOutcome, type OfficePrintPort } from "../../print";
import { buildPdfPrintCopy } from "./print-copy";
import { renderPdfPrintPages } from "./render-pages";
import { PdfPrintError, type PdfPrintRenderRequest } from "./types";

export interface PdfPrintDocumentRequest extends PdfPrintRenderRequest {
  /** The injected host print path (browser frame on web, main's window on desktop). */
  port: OfficePrintPort;
  title: string;
  lang?: string;
}

/**
 * The PDF print action: render every original page, build the copy, hand it
 * to the port. Every failure - a page that did not render, a copy too large to
 * print, a port that throws - comes back as a typed `failed` outcome with the
 * reason code, so the caller never sees a crash and never a partial print.
 */
export async function printPdfDocument(request: PdfPrintDocumentRequest): Promise<OfficePrintOutcome> {
  let html: string;
  try {
    const { pages } = await renderPdfPrintPages(request);
    html = buildPdfPrintCopy({ pages, title: request.title, lang: request.lang });
  } catch (error) {
    if (error instanceof PdfPrintError) return { outcome: "failed", reason: error.code };
    return { outcome: "failed", reason: "render_failed" };
  }
  if (request.signal?.aborted) return { outcome: "failed", reason: "cancelled" };
  try {
    return await request.port.print({ html, title: request.title, page: printPageFromCopy(html) });
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
