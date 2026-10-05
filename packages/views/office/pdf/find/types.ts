import type { PdfTextDoc, ReadPdfTextOptions } from "@uniwork/office-engine/pdf";

export type PdfTextDocument = PdfTextDoc;
export type PdfTextReader = (bytes: Uint8Array, options?: ReadPdfTextOptions) => Promise<PdfTextDoc>;

/** One character box in the page's DISPLAY space (the /Rotate transform
 * already applied): top-left origin, same units as the page width x height. */
export interface PdfCharBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One rectangle in the page's DISPLAY space (origin bottom-left, the /Rotate
 * transform applied) as [x1, y1, x2, y2]. */
export type PdfSearchQuad = readonly [number, number, number, number];

export interface PdfSearchHit {
  id: string;
  page: number;
  start: number;
  end: number;
  text: string;
  /** Per-line rectangles in the page's DISPLAY space (/Rotate applied, origin
   * bottom-left, same units as the page width/height); absent when the
   * host cannot read page geometry, so the hit simply paints nothing. */
  quads?: readonly PdfSearchQuad[];
}

export interface PdfSearchHighlightProps {
  "data-pdf-search-hit": string;
  "data-pdf-search-page": string;
  "data-pdf-search-start": string;
  "data-pdf-search-end": string;
  "data-pdf-search-active": string;
}
