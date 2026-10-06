// UNI-925 FIX-FIT: the PDF zoom/fit model.
//
// F-12 (web + desktop): "Fit width" and "Fit page" reset the zoom to 100%
// instead of fitting the pane, and "Fit page" left the page overflowing
// vertically. The reason was that both handlers were `setZoom(1)`. This module
// owns the pure math so the handlers can fit the page into the *measured*
// canvas viewport (the scroll container) rather than a constant, and so the
// page box follows a page's /Rotate.

export const PDF_MIN_ZOOM = 0.25;
export const PDF_MAX_ZOOM = 4;
/** Space the fit modes leave free around the page, in CSS px: the canvas
 *  gutter plus the scrollbar the pane may grow. Mirrors the standalone
 *  PdfView's fit padding. */
export const PDF_FIT_PADDING_PX = 32;

/** A page's own box in PDF points; `rotation` is its /Rotate in degrees. */
export interface PdfZoomPageSize {
  width: number;
  height: number;
  rotation?: number;
}

/** The measured canvas viewport in CSS px (the scroll container). */
export interface PdfPaneSize {
  width: number;
  height: number;
}

/** Quarter turns clockwise for a /Rotate value; 0/90/180/270 map to 0/1/2/3. */
function quarterTurns(rotation: number | undefined): number {
  return ((Math.round((rotation ?? 0) / 90) % 4) + 4) % 4;
}

/** The page's box as displayed after its rotation: a quarter-turn page has its
 *  axes swapped, so fit must divide by the displayed width/height. */
export function pdfDisplaySize(page: PdfZoomPageSize): { width: number; height: number } {
  const turns = quarterTurns(page.rotation);
  if (turns % 2 === 1) return { width: page.height, height: page.width };
  return { width: page.width, height: page.height };
}

/** Clamp to the supported zoom range; two decimals so the readout is stable. */
export function clampPdfZoom(value: number): number {
  return Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, Number(value.toFixed(2))));
}

/**
 * The zoom that fits `page` into `pane`, or null when either cannot be
 * measured yet (the caller then keeps the current zoom, as the standalone
 * PdfView does). `fit-width` divides the pane's width by the page's displayed
 * width; `fit-page` uses the smaller of the two ratios so the page no longer
 * overflows vertically. A measurable but tiny pane clamps to the zoom floor
 * rather than reading as unmeasurable.
 */
export function fitPdfZoom(mode: "fit-width" | "fit-page", pane: PdfPaneSize, page: PdfZoomPageSize): number | null {
  const display = pdfDisplaySize(page);
  if (!(display.width > 0) || !(pane.width > 0)) return null;
  const widthFit = (pane.width - PDF_FIT_PADDING_PX) / display.width;
  if (mode === "fit-width") return clampPdfZoom(widthFit);
  if (!(display.height > 0) || !(pane.height > 0)) return null;
  const heightFit = (pane.height - PDF_FIT_PADDING_PX) / display.height;
  return clampPdfZoom(Math.min(widthFit, heightFit));
}
