import type { PdfSearchHit, PdfSearchHighlightProps, PdfTextDocument } from "./types";

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

interface FoldedText {
  value: string;
  map: readonly { start: number; end: number }[];
}

function foldWithMap(value: string): FoldedText {
  let folded = "";
  let sourceOffset = 0;
  const map: { start: number; end: number }[] = [];
  for (const character of value) {
    const sourceStart = sourceOffset;
    sourceOffset += character.length;
    const foldedCharacter = fold(character);
    folded += foldedCharacter;
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      map.push({ start: sourceStart, end: sourceOffset });
    }
  }
  return { value: folded, map };
}

export function findPdfTextHits(document: PdfTextDocument, query: string): PdfSearchHit[] {
  const foldedQuery = fold(query);
  if (!foldedQuery) return [];
  const hits: PdfSearchHit[] = [];
  for (const page of document.pages) {
    const foldedText = foldWithMap(page.text);
    let cursor = 0;
    while (cursor < foldedText.value.length) {
      const start = foldedText.value.indexOf(foldedQuery, cursor);
      if (start < 0) break;
      const end = start + foldedQuery.length;
      const sourceStart = foldedText.map[start]?.start;
      const sourceEnd = foldedText.map[end - 1]?.end;
      if (sourceStart === undefined || sourceEnd === undefined) break;
      hits.push({ id: `${page.page}:${sourceStart}:${sourceEnd}`, page: page.page, start: sourceStart, end: sourceEnd, text: page.text.slice(sourceStart, sourceEnd) });
      cursor = end;
    }
  }
  return hits;
}

export function getPdfSearchHighlightProps(hit: PdfSearchHit, active: boolean): PdfSearchHighlightProps {
  return {
    "data-pdf-search-hit": hit.id,
    "data-pdf-search-page": String(hit.page),
    "data-pdf-search-start": String(hit.start),
    "data-pdf-search-end": String(hit.end),
    "data-pdf-search-active": String(active),
  };
}
