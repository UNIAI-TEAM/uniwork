import type { PdfCanvasPage, PdfPageRenderService } from "../canvas";

/** Why a PDF print copy could not be built. Every one ends the print run as a
 * typed failure: a page that does not render never yields a partial printout. */
export type PdfPrintFailureCode =
  /** The document has no page to print. */
  | "no_pages"
  /** A page did not render, or rendered to something that is not an inline image. */
  | "render_failed"
  /** Even at the lowest print resolution the copy would exceed the print cap. */
  | "print_too_large"
  /** The run was aborted (the editor unmounted or the document changed). */
  | "cancelled";

export class PdfPrintError extends Error {
  readonly code: PdfPrintFailureCode;

  constructor(code: PdfPrintFailureCode, message?: string) {
    super(message ?? `PDF print failed: ${code}`);
    this.name = "PdfPrintError";
    this.code = code;
  }
}

/** Turns a host render `src` (a `data:` URL on desktop, a `blob:` URL on web)
 * into an inline `data:` URL the print copy can carry. */
export type PdfPrintImageInliner = (src: string, signal?: AbortSignal) => Promise<string>;

/** One page of the print copy: its size in PDF points (display size, /Rotate
 * applied) and its raster as an inline image. */
export interface PdfPrintPage {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  /** `data:image/(png|jpeg|webp);base64,...`, never a URL that loads anything. */
  src: string;
}

export interface PdfPrintRenderRequest {
  renderer: PdfPageRenderService;
  /** Every page of the document, in display order. */
  pages: readonly PdfCanvasPage[];
  /** Defaults to fetching the URL into a `data:` URL. */
  inlineImage?: PdfPrintImageInliner;
  /** Byte budget for the inline images; defaults to {@link PDF_PRINT_IMAGE_BUDGET_BYTES}. */
  maxImageBytes?: number;
  signal?: AbortSignal;
  /** 1-based page position of the page being rendered. */
  onProgress?(progress: { page: number; total: number }): void;
}

/** The desktop print IPC refuses a copy above 16 MiB (PRINT_HTML_MAX_BYTES);
 * the images get that minus a margin for the markup around them. */
export const PDF_PRINT_IMAGE_BUDGET_BYTES = 16 * 1024 * 1024 - 256 * 1024;
