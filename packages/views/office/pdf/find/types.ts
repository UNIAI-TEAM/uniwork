import type { PdfTextDoc, ReadPdfTextOptions } from "@uniwork/office-engine/pdf";

export type PdfTextDocument = PdfTextDoc;
export type PdfTextReader = (bytes: Uint8Array, options?: ReadPdfTextOptions) => Promise<PdfTextDoc>;

/** One character box on a page, top-left origin, PDF points. */
export interface PdfCharBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One rectangle in PDF user space (origin bottom-left) as [x1, y1, x2, y2]. */
export type PdfSearchQuad = readonly [number, number, number, number];

export interface PdfSearchHit {
  id: string;
  page: number;
  start: number;
  end: number;
  text: string;
  /** Per-line rectangles in PDF user space (origin bottom-left); absent when the
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
