import type { PdfPageText, PdfTextDoc, ReadPdfTextOptions } from "@uniwork/office-engine/pdf";

export type PdfTextDocument = PdfTextDoc;
export type PdfTextPage = PdfPageText;
export type PdfTextReader = (bytes: Uint8Array, options?: ReadPdfTextOptions) => Promise<PdfTextDoc>;

export interface PdfSearchHit {
  id: string;
  page: number;
  start: number;
  end: number;
  text: string;
}

export interface PdfSearchHighlightProps {
  "data-pdf-search-hit": string;
  "data-pdf-search-page": string;
  "data-pdf-search-start": string;
  "data-pdf-search-end": string;
  "data-pdf-search-active": string;
}
