import type { PdfSearchHit, PdfTextDocument } from "./types";

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

export function findPdfTextHits(document: PdfTextDocument, query: string): PdfSearchHit[] {
  const foldedQuery = fold(query);
  if (!foldedQuery) return [];
  const hits: PdfSearchHit[] = [];
  for (const page of document.pages) {
    const foldedText = fold(page.text);
    let cursor = 0;
    while (cursor < foldedText.length) {
      const start = foldedText.indexOf(foldedQuery, cursor);
      if (start < 0) break;
      const end = start + foldedQuery.length;
      hits.push({ id: `${page.page}:${start}:${end}`, page: page.page, start, end, text: page.text.slice(start, end) });
      cursor = end;
    }
  }
  return hits;
}

export function getPdfSearchHighlightProps(hit: PdfSearchHit, active: boolean): Record<`data-pdf-search-${string}`, string> {
  return {
    "data-pdf-search-hit": hit.id,
    "data-pdf-search-page": String(hit.page),
    "data-pdf-search-start": String(hit.start),
    "data-pdf-search-end": String(hit.end),
    "data-pdf-search-active": String(active),
  };
}
