import { describe, expect, it } from "vitest";
import { findPdfTextHits, getPdfSearchHighlightProps } from "./search-model";
import type { PdfTextDocument } from "./types";

const doc: PdfTextDocument = {
  pageCount: 2,
  info: {},
  truncated: false,
  pages: [
    { page: 1, widthPt: 100, heightPt: 100, chars: 10, hasTextLayer: true, text: "Alpha beta\nALPHA" },
    { page: 2, widthPt: 100, heightPt: 100, chars: 4, hasTextLayer: true, text: "gamma" },
  ],
};

describe("findPdfTextHits", () => {
  it("finds case-insensitive matches with page and text offsets", () => {
    expect(findPdfTextHits(doc, "alpha")).toEqual([
      { id: "1:0:5", page: 1, start: 0, end: 5, text: "Alpha" },
      { id: "1:11:16", page: 1, start: 11, end: 16, text: "ALPHA" },
    ]);
  });

  it("returns no matches for an empty query and supports unicode folding", () => {
    const unicode: PdfTextDocument = { ...doc, pages: [{ ...doc.pages[0], text: "Café cafe" }] };
    expect(findPdfTextHits(unicode, "")).toEqual([]);
    expect(findPdfTextHits(unicode, "cafe").map((hit) => hit.start)).toEqual([0, 5]);
  });

  it("exposes stable canvas highlight props", () => {
    expect(getPdfSearchHighlightProps({ id: "2:1:3", page: 2, start: 1, end: 3, text: "am" }, true)).toEqual({
      "data-pdf-search-hit": "2:1:3",
      "data-pdf-search-page": "2",
      "data-pdf-search-start": "1",
      "data-pdf-search-end": "3",
      "data-pdf-search-active": "true",
    });
  });
});
