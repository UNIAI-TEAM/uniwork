// Page-structure operations — ported from office-upstream
// apps/pdf/src/main/save-pdf.ts (insertBlankPageBytes, insertPdfBytes,
// extractPagesBytes, splitPdfBytes, mergePdfBytes). Two families:
//
//   * In-place inserts (insertBlankPage, insertPdf) grow the working document
//     in the pdf-lib stage. They only touch the page tree: every page that
//     already existed keeps its own content stream and annotation array, and
//     copied pages are deep copies (pdf-lib copyPages), so nothing is shared
//     with the source bytes.
//   * Document producers (extractPages, splitPdf, mergePdf) read the working
//     bytes and return NEW documents; the working document is not modified.
//     F2: the caller persists them through a Documents commit, never a
//     download or a local directory.
//
// `afterPageIndex` follows upstream: the index of the page the new content goes
// AFTER in the document as it was opened, -1 meaning the front. The helpers
// below take that same convention and clamp it to a real insertion position.
import { PDFDocument } from "pdf-lib";
import type { PDFPage } from "pdf-lib";

/** Typed refusal for a source PDF the caller supplied that cannot be used
    (undecodable base64 or bytes pdf-lib cannot load). The op is well formed;
    its payload is not, so this is a refusal rather than an honest skip. */
export class PdfPageOpSourceError extends Error {
  readonly op: string;
  readonly reason: string;
  constructor(op: string, reason: string) {
    super(`${op}: ${reason}`);
    this.name = "PdfPageOpSourceError";
    this.op = op;
    this.reason = reason;
  }
}

export interface InsertBlankPageResult {
  bytes: Uint8Array;
  insertedIndex: number;
}
export interface InsertPdfResult {
  bytes: Uint8Array;
  count: number;
  insertedIndex: number;
}
export interface ExtractPagesResult {
  bytes: Uint8Array;
  pageCount: number;
}
export interface SplitPdfResult {
  parts: { bytes: Uint8Array; pageCount: number }[];
}
export interface MergePdfResult {
  bytes: Uint8Array;
  appended: number;
  pageCount: number;
}

/** A4 in PDF points — the fallback for a blank page inserted into an empty document. */
const A4: [number, number] = [595.28, 841.89];

/** Clamp an "insert after index" (-1 = front) to a real insertion position. */
function insertPosition(afterPageIndex: number, pageCount: number): number {
  return Math.min(Math.max(afterPageIndex + 1, 0), pageCount);
}

/** Indices of `pages` that exist in a document of `pageCount` pages, in the
    requested order. Duplicates are kept, as upstream does: repeating a page is
    a legitimate way to copy it more than once. */
function validPageIndices(pages: readonly number[], pageCount: number): number[] {
  const valid: number[] = [];
  for (const page of pages) {
    if (!Number.isSafeInteger(page) || page < 0 || page >= pageCount) continue;
    valid.push(page);
  }
  return valid;
}

/** Insert one blank page and return its index. The neighbor's size and
    /Rotate are copied unless an explicit size is given, so the blank page
    neither shrinks the sheet nor displays sideways next to its neighbor. */
function insertBlankPageInto(
  doc: PDFDocument,
  afterPageIndex: number,
  size?: readonly [number, number],
): number {
  const pageCount = doc.getPageCount();
  const at = insertPosition(afterPageIndex, pageCount);
  const neighbor = pageCount > 0 ? doc.getPage(Math.min(Math.max(afterPageIndex, 0), pageCount - 1)) : null;
  const dims: [number, number] = size ? [size[0], size[1]] : neighbor ? [neighbor.getWidth(), neighbor.getHeight()] : A4;
  const page: PDFPage = doc.insertPage(at, dims);
  if (neighbor) page.setRotation(neighbor.getRotation());
  return at;
}

/** Insert pages of another document after `afterPageIndex`; returns the
    insertion index and how many pages were inserted. */
async function insertPdfInto(
  doc: PDFDocument,
  source: PDFDocument,
  afterPageIndex: number,
  pages?: readonly number[],
): Promise<{ at: number; count: number }> {
  const indices = pages ? validPageIndices(pages, source.getPageCount()) : source.getPageIndices();
  if (indices.length === 0) return { at: insertPosition(afterPageIndex, doc.getPageCount()), count: 0 };
  const copied = await doc.copyPages(source, indices);
  const at = insertPosition(afterPageIndex, doc.getPageCount());
  let cursor = at;
  for (const page of copied) doc.insertPage(cursor++, page);
  return { at, count: copied.length };
}

/** Extract the given pages (input indices) into bytes of a new PDF. */
export async function extractPagesBytes(bytes: Uint8Array, pages: readonly number[]): Promise<ExtractPagesResult> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const valid = validPageIndices(pages, src.getPageCount());
  if (valid.length === 0) return { bytes: new Uint8Array(), pageCount: 0 };
  const copied = await out.copyPages(src, valid);
  for (const page of copied) out.addPage(page);
  return { bytes: await out.save({ useObjectStreams: false }), pageCount: copied.length };
}

/** Split into consecutive chunks of `chunkSize` pages, each its own PDF. */
export async function splitPdfBytes(bytes: Uint8Array, chunkSize: number): Promise<SplitPdfResult> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const total = src.getPageCount();
  const size = Math.max(1, Math.floor(chunkSize));
  const parts: { bytes: Uint8Array; pageCount: number }[] = [];
  for (let start = 0; start < total; start += size) {
    const part = await PDFDocument.create();
    const count = Math.min(size, total - start);
    const copied = await part.copyPages(src, Array.from({ length: count }, (_value, i) => start + i));
    for (const page of copied) part.addPage(page);
    parts.push({ bytes: await part.save({ useObjectStreams: false }), pageCount: count });
  }
  return { parts };
}

/** Append all pages of `others` (in order) to `first`; returns combined bytes. */
export async function mergePdfBytes(first: Uint8Array, others: readonly Uint8Array[]): Promise<MergePdfResult> {
  const dst = await PDFDocument.load(first, { updateMetadata: false });
  let appended = 0;
  for (const otherBytes of others) {
    const src = await loadSource(otherBytes, "mergePdfs");
    const copied = await dst.copyPages(src, src.getPageIndices());
    for (const page of copied) dst.addPage(page);
    appended += copied.length;
  }
  return { bytes: await dst.save({ useObjectStreams: false }), appended, pageCount: dst.getPageCount() };
}

/** Load a caller-supplied PDF, refusing bytes pdf-lib cannot read. */
async function loadSource(bytes: Uint8Array, op: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new PdfPageOpSourceError(op, "source bytes are not a readable PDF");
  }
}

/** Insert all pages of another PDF after `afterPageIndex` (-1 = front). */
export async function insertPdfBytes(
  bytes: Uint8Array,
  otherBytes: Uint8Array,
  afterPageIndex: number,
  pages?: readonly number[],
): Promise<InsertPdfResult> {
  const dst = await PDFDocument.load(bytes, { updateMetadata: false });
  const src = await loadSource(otherBytes, "insertPdfPages");
  const { at, count } = await insertPdfInto(dst, src, afterPageIndex, pages);
  return { bytes: await dst.save({ useObjectStreams: false }), count, insertedIndex: at };
}

/** Insert one blank page after `afterPageIndex` (-1 = front). */
export async function insertBlankPageBytes(
  bytes: Uint8Array,
  afterPageIndex: number,
  size?: readonly [number, number],
): Promise<InsertBlankPageResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const insertedIndex = insertBlankPageInto(doc, afterPageIndex, size);
  return { bytes: await doc.save({ useObjectStreams: false }), insertedIndex };
}
