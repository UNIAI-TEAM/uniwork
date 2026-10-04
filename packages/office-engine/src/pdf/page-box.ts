// Page-box and N-up imposition — the B7 engine half of the page-structure
// lane, alongside page-ops.ts. Two transforms of the working document:
//
//   * setPageBox rewrites a page's MediaBox or CropBox in place. pdf-lib takes
//     (x, y, width, height), so the wire [left, bottom, right, top] rect is
//     converted here.
//   * setNUp imposes the requested pages onto rows x cols sheets. Source pages
//     are deep-copied first (pdf-lib copyPages, as page-ops.ts does), then the
//     working document's page tree is replaced by the sheets, each source page
//     drawn scaled into its grid cell.
//
// Both refuse malformed input with a typed PdfOpError instead of silently
// dropping a page: a bad index or a degenerate rect is a caller bug, not a
// best-effort skip.
import { PDFDocument, PDFName, PageSizes } from "pdf-lib";
import { PdfOpError } from "./op-parse.ts";
import type { NUpPaper, SetNUpInput, SetNUpResult, SetPageBoxInput, SetPageBoxResult } from "./types.ts";

const OP_SET_PAGE_BOX = "setPageBox";
const OP_SET_N_UP = "setNUp";

/** Sheet dimensions in PDF points for each wire paper name. */
const PAPERS: Record<NUpPaper, readonly [number, number]> = {
  a4: [PageSizes.A4[0], PageSizes.A4[1]],
  letter: [PageSizes.Letter[0], PageSizes.Letter[1]],
};

/** Refuse anything but a safe integer page index inside [0, pageCount). */
function requirePageIndex(page: unknown, pageCount: number, op: string): number {
  if (typeof page !== "number" || !Number.isSafeInteger(page)) {
    throw new PdfOpError(op, "pages[]", "integer page index required");
  }
  if (page < 0 || page >= pageCount) {
    throw new PdfOpError(op, "pages[]", `page index ${page} is outside 0..${pageCount - 1}`);
  }
  return page;
}

/** Non-empty page list, every index in range (refused, never filtered out). */
function requirePageList(pages: readonly number[], pageCount: number, op: string): number[] {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new PdfOpError(op, "pages", "at least one page required");
  }
  return pages.map((page) => requirePageIndex(page, pageCount, op));
}

/** A positive integer bound (rows/cols). */
function requirePositiveInt(value: unknown, op: string, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new PdfOpError(op, field, "positive integer required");
  }
  return value;
}

/** Wire [left, bottom, right, top] with positive width and height. */
function requireRect(rect: readonly number[], op: string): { x: number; y: number; width: number; height: number } {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new PdfOpError(op, "rect", "[left,bottom,right,top] number tuple required");
  }
  const [left, bottom, right, top] = rect as [number, number, number, number];
  const width = right - left;
  const height = top - bottom;
  if (width <= 0 || height <= 0) {
    throw new PdfOpError(op, "rect", "right must exceed left and top must exceed bottom");
  }
  return { x: left, y: bottom, width, height };
}

/** Set the MediaBox or CropBox of each requested page in place. */
export function setPageBox(doc: PDFDocument, input: SetPageBoxInput): SetPageBoxResult {
  const op = OP_SET_PAGE_BOX;
  if (input.box !== "media" && input.box !== "crop") {
    throw new PdfOpError(op, "box", '"media" or "crop" required');
  }
  const rect = requireRect(input.rect, op);
  const indices = requirePageList(input.pages, doc.getPageCount(), op);
  for (const index of indices) {
    const page = doc.getPage(index);
    if (input.box === "media") page.setMediaBox(rect.x, rect.y, rect.width, rect.height);
    else page.setCropBox(rect.x, rect.y, rect.width, rect.height);
  }
  return { applied: indices.length };
}

/** Impose the requested pages onto rows x cols sheets, replacing the page tree.
    `paper` sizes every sheet; absent, the first source page's own size is used. */
export async function setNUp(doc: PDFDocument, input: SetNUpInput): Promise<SetNUpResult> {
  const op = OP_SET_N_UP;
  const rows = requirePositiveInt(input.layout.rows, op, "layout.rows");
  const cols = requirePositiveInt(input.layout.cols, op, "layout.cols");
  if (input.paper !== undefined && input.paper !== "a4" && input.paper !== "letter") {
    throw new PdfOpError(op, "paper", '"a4" or "letter" required');
  }
  const indices = requirePageList(input.pages, doc.getPageCount(), op);

  // Deep-copy first (a fresh document, as page-ops.ts does), because the
  // originals are removed below and the copies must not share content streams
  // with the source bytes.
  const source = await PDFDocument.create();
  const copied = await source.copyPages(doc, indices);
  // pdf-lib refuses to embed a page with no /Contents; a blank source page is
  // legitimate, so give each such copy an empty content stream to embed.
  for (const page of copied) {
    if (page.node.Contents() === undefined) page.node.set(PDFName.of("Contents"), source.context.obj([]));
  }
  const embedded = await doc.embedPages(copied);

  const [sheetWidth, sheetHeight] = input.paper
    ? PAPERS[input.paper]
    : [embedded[0].width, embedded[0].height];
  const perSheet = rows * cols;
  const cellWidth = sheetWidth / cols;
  const cellHeight = sheetHeight / rows;

  for (let index = doc.getPageCount() - 1; index >= 0; index -= 1) doc.removePage(index);

  const sheets = Math.ceil(embedded.length / perSheet);
  for (let sheet = 0; sheet < sheets; sheet += 1) {
    const out = doc.addPage([sheetWidth, sheetHeight]);
    for (let slot = 0; slot < perSheet; slot += 1) {
      const sourceIndex = sheet * perSheet + slot;
      if (sourceIndex >= embedded.length) break;
      const page = embedded[sourceIndex];
      const row = Math.floor(slot / cols);
      const col = slot % cols;
      const cellLeft = col * cellWidth;
      // Grid rows run top-to-bottom; PDF y is up, so row 0 sits at the top.
      const cellBottom = sheetHeight - (row + 1) * cellHeight;
      const scale = Math.min(cellWidth / page.width, cellHeight / page.height);
      out.drawPage(page, {
        x: cellLeft + (cellWidth - page.width * scale) / 2,
        y: cellBottom + (cellHeight - page.height * scale) / 2,
        xScale: scale,
        yScale: scale,
      });
    }
  }

  return { sheets, pages: embedded.length, rows, cols };
}
