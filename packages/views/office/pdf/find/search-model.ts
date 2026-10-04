import type { PdfCharBox, PdfSearchHit, PdfSearchHighlightProps, PdfSearchQuad, PdfTextDocument } from "./types";

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

/** Union the character boxes a hit covers into one rectangle per line, in PDF
 * user space (origin bottom-left). Boxes are top-left-origin; a box that shares
 * a line with the previous one joins it, and a box whose vertical span does not
 * overlap the line starts a new one (the y baseline jumped). Zero-size boxes
 * (a char pdfium had no box for) are skipped. */
export function quadsForRange(
  boxes: readonly PdfCharBox[],
  start: number,
  end: number,
  pageHeight: number,
): PdfSearchQuad[] {
  const quads: PdfSearchQuad[] = [];
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  let open = false;
  const flush = () => {
    if (!open) return;
    // Top-left box space -> bottom-left quad space: [left, bottom, right, top].
    quads.push([left, pageHeight - bottom, right, pageHeight - top]);
    open = false;
  };
  const limit = Math.min(end, boxes.length);
  for (let index = Math.max(0, start); index < limit; index += 1) {
    const box = boxes[index];
    if (!box || (box.width <= 0 && box.height <= 0)) continue;
    const boxTop = box.y;
    const boxBottom = box.y + box.height;
    // A new line when this box does not vertically overlap the open one.
    if (open && !(boxTop < bottom && boxBottom > top)) flush();
    if (!open) {
      left = box.x;
      right = box.x + box.width;
      top = boxTop;
      bottom = boxBottom;
      open = true;
    } else {
      left = Math.min(left, box.x);
      right = Math.max(right, box.x + box.width);
      top = Math.min(top, boxTop);
      bottom = Math.max(bottom, boxBottom);
    }
  }
  flush();
  return quads;
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
