// Node-side page rasterisation and text-layer reads for the desktop PDF lane.
// The wasm pdfium seam (src/pdf/pdfium.ts) is shared with the text/edit paths,
// so every call here is queued behind chainPdfium: the module is one global
// heap and a render must not interleave with an edit. Nothing here writes back
// to the document — the input bytes are only read, and every pdfium pointer is
// released in a finally block, except the one retained document kept loaded
// for the next page (released through releaseLoadedPdf).
import { PdfPasswordError, PdfTypedError } from "../pdf/adapter.ts";
import { encodeBgraToPng } from "../pdf/codec.ts";
import { chainPdfium, closeDocument, FPDF_BITMAP_BGRA, FPDF_ERR_PASSWORD, FPDF_ERR_SECURITY, loadPdfium, openDocument, PdfOpenError, type OpenedDocument, type Pdfium } from "../pdf/pdfium.ts";

/** Load `bytes` in pdfium, mapping a load failure to the same typed refusal
 * the open/edit lane answers: a password wall is PdfPasswordError (so the host
 * can return it as data), a security handler a password cannot satisfy is a
 * named refusal, and any other load failure is corruption. A heap failure is
 * engine-side and rethrows. */
function openRenderedDocument(m: Pdfium, bytes: Uint8Array, password: string | undefined): OpenedDocument {
  try {
    return openDocument(m, bytes, password);
  } catch (error) {
    if (error instanceof PdfOpenError) {
      if (error.detail === FPDF_ERR_PASSWORD) throw new PdfPasswordError(password === undefined ? "required" : "wrong");
      if (error.detail === FPDF_ERR_SECURITY) throw new PdfTypedError("unsupported_operation", "certificate_encrypted");
      if (error.detail === "heap") throw error;
      throw new PdfTypedError("engine_result_invalid", "corrupt_pdf");
    }
    throw error;
  }
}

/** The one retained document kept loaded across chainPdfium turns, so a print
 * walking N pages of one document parses it once instead of N times. It is
 * keyed by the host's retained handle, whose bytes never change. Only one is
 * kept, which bounds the extra wasm heap to one document. */
let loaded: { readonly key: string; readonly opened: OpenedDocument } | null = null;

function closeLoaded(m: Pdfium): void {
  if (!loaded) return;
  const { opened } = loaded;
  loaded = null;
  closeDocument(m, opened);
}

/** Free the loaded document: the one `key` names, or whichever is loaded when
 * `key` is omitted. Queued behind chainPdfium like every other heap use. */
export function releaseLoadedPdf(key?: string): Promise<void> {
  return chainPdfium(async () => {
    if (!loaded || (key !== undefined && loaded.key !== key)) return;
    closeLoaded(await loadPdfium());
  });
}

/** Test seam: the key of the loaded document, if any. */
export function loadedPdfKeyForTests(): string | null {
  return loaded?.key ?? null;
}

/** Run `fn` on `bytes` loaded in pdfium. With a `retainedKey` the document
 * stays loaded for the next call with that key (replacing any other loaded
 * one); without one it is closed when `fn` settles. */
async function withRenderedDocument<T>(
  m: Pdfium,
  bytes: Uint8Array,
  password: string | undefined,
  fn: (doc: number) => Promise<T>,
  retainedKey?: string,
): Promise<T> {
  if (retainedKey === undefined) {
    const opened = openRenderedDocument(m, bytes, password);
    try {
      return await fn(opened.doc);
    } finally {
      closeDocument(m, opened);
    }
  }
  if (loaded?.key !== retainedKey) {
    closeLoaded(m);
    loaded = { key: retainedKey, opened: openRenderedDocument(m, bytes, password) };
  }
  return await fn(loaded.opened.doc);
}

/** pdfium render flag: draw page annotations (FPDF_ANNOT). */
const FPDF_ANNOT = 0x01;
/** Longest rendered side, in pixels. A deep zoom on a large page can ask for
    hundreds of megapixels; clamp instead of allocating the wasm heap away. */
const MAX_RENDER_SIDE = 8192;

/**
 * Rasterise one 0-based page to a base64 PNG at `scale` device pixels per PDF
 * point. `null` means the page index is out of range or pdfium could not
 * allocate the bitmap — the caller answers a typed refusal instead of an empty
 * image. An encrypted document needs the same `password` its open used.
 */
export function renderPdfPagePng(
  bytes: Uint8Array,
  pageIndex: number,
  scale: number,
  password?: string,
  retainedKey?: string,
): Promise<{ pngBase64: string; width: number; height: number } | null> {
  return chainPdfium(async () => {
    const m = await loadPdfium();
    return withRenderedDocument(m, bytes, password, async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc);
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return null;
      const page = m._FPDF_LoadPage(doc, pageIndex);
      if (!page) return null;
      try {
        let width = Math.max(1, Math.round(m._FPDF_GetPageWidthF(page) * scale));
        let height = Math.max(1, Math.round(m._FPDF_GetPageHeightF(page) * scale));
        const shrink = Math.min(1, MAX_RENDER_SIDE / Math.max(width, height));
        if (shrink < 1) {
          width = Math.max(1, Math.floor(width * shrink));
          height = Math.max(1, Math.floor(height * shrink));
        }
        const bufPtr = m._malloc(width * height * 4);
        if (!bufPtr) return null;
        const bitmap = m._FPDFBitmap_CreateEx(width, height, FPDF_BITMAP_BGRA, bufPtr, width * 4);
        if (!bitmap) {
          m._free(bufPtr);
          return null;
        }
        try {
          m._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
          m._FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT);
          const buffer = m._FPDFBitmap_GetBuffer(bitmap);
          const stride = m._FPDFBitmap_GetStride(bitmap);
          const bitmapWidth = m._FPDFBitmap_GetWidth(bitmap);
          const bitmapHeight = m._FPDFBitmap_GetHeight(bitmap);
          if (!buffer || bitmapWidth <= 0 || bitmapHeight <= 0) return null;
          const tight = Buffer.alloc(bitmapWidth * bitmapHeight * 4);
          for (let row = 0; row < bitmapHeight; row += 1) {
            tight.set(
              m.HEAPU8.subarray(buffer + row * stride, buffer + row * stride + bitmapWidth * 4),
              row * bitmapWidth * 4,
            );
          }
          return {
            pngBase64: encodeBgraToPng(tight, bitmapWidth, bitmapHeight).toString("base64"),
            width: bitmapWidth,
            height: bitmapHeight,
          };
        } finally {
          m._FPDFBitmap_Destroy(bitmap);
          m._free(bufPtr);
        }
      } finally {
        m._FPDF_ClosePage(page);
      }
    }, retainedKey);
  });
}

/**
 * Page sizes in PDF points, in page order. The renderer lays out one page box
 * per entry, so a portrait A4 page is not shown as a wide landscape box; a page
 * pdfium cannot load reports a zero size rather than dropping out of order.
 */
export function readPdfPageSizes(
  bytes: Uint8Array,
  password?: string,
): Promise<{ width: number; height: number }[]> {
  return chainPdfium(async () => {
    const m = await loadPdfium();
    return withRenderedDocument(m, bytes, password, async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc);
      const sizes: { width: number; height: number }[] = [];
      for (let index = 0; index < pageCount; index += 1) {
        const page = m._FPDF_LoadPage(doc, index);
        if (!page) {
          sizes.push({ width: 0, height: 0 });
          continue;
        }
        try {
          sizes.push({ width: m._FPDF_GetPageWidthF(page), height: m._FPDF_GetPageHeightF(page) });
        } finally {
          m._FPDF_ClosePage(page);
        }
      }
      return sizes;
    });
  });
}

/** One character's box in the page's DISPLAY space: top-left origin, PDF points,
 * the /Rotate transform applied - the same space as the rendered raster and the
 * reported page size. */
interface DesktopPdfCharBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One page's text layer plus the geometry a find hit needs to paint. */
export interface DesktopPdfTextPage {
  /** 1-based page number. */
  readonly page: number;
  /** Display size in points (the /Rotate transform applied). */
  readonly width: number;
  readonly height: number;
  /** Text with \n line breaks; empty when the page has no text layer. */
  readonly text: string;
  /** One box per character of `text`, in that same index space; a char with no
   * box is a zero-size box so offsets stay aligned. */
  readonly charBoxes: readonly DesktopPdfCharBox[];
}

/** The Node seam's Pdfium slice plus the rotation probe the char-box mapping
 * needs; the wasm build exports it (the browser seam declares it too). */
interface RotationAwarePdfium extends Pdfium {
  _FPDFPage_GetRotation(page: number): number;
}

/** Fail loudly when the loaded module lacks the rotation export: silently
 * answering 0 would paint every find hit on a rotated page in the wrong place. */
export function assertRotationAware(m: Pdfium): asserts m is RotationAwarePdfium {
  if (typeof (m as Partial<RotationAwarePdfium>)._FPDFPage_GetRotation !== "function") {
    throw new Error("pdfium_export_missing: FPDFPage_GetRotation");
  }
}

/** Quarter turns clockwise for a page rotation; 0/90/180/270 map to 0/1/2/3. */
function pageRotation(m: RotationAwarePdfium, page: number): number {
  return ((Math.round(m._FPDFPage_GetRotation(page)) % 4) + 4) % 4;
}

/** Map one top-left-origin box from the page's unrotated space into its DISPLAY
 * space by applying the same clockwise /Rotate transform the raster uses. */
function toDisplayBox(
  box: DesktopPdfCharBox,
  rotation: number,
  unrotatedWidth: number,
  unrotatedHeight: number,
): DesktopPdfCharBox {
  switch (rotation) {
    case 1: return { x: unrotatedHeight - box.y - box.height, y: box.x, width: box.height, height: box.width };
    case 2: return { x: unrotatedWidth - box.x - box.width, y: unrotatedHeight - box.y - box.height, width: box.width, height: box.height };
    case 3: return { x: box.y, y: unrotatedWidth - box.x - box.width, width: box.height, height: box.width };
    default: return box;
  }
}

/** Whole-textpage text (UTF-16LE, pdfium uses \r\n) normalised to \n, keeping the
 * mapping from each normalised character back to its raw char index so the char
 * boxes stay in the same index space as the text. */
function normalizePageText(raw: string): { text: string; rawIndex: number[] } {
  let text = "";
  const rawIndex: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character === "\r") {
      text += "\n";
      rawIndex.push(index);
      if (raw[index + 1] === "\n") index += 1;
    } else {
      text += character;
      rawIndex.push(index);
    }
  }
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1]!)) end -= 1;
  return { text: text.slice(0, end), rawIndex: rawIndex.slice(0, end) };
}

/** Read a page's text layer and, when `geometry` is set, one display-space box
 * per character so the renderer can union a find hit's characters into per-line
 * quads. A page with no text layer answers empty text and no boxes (scanned
 * pages). */
function readPageText(
  m: RotationAwarePdfium,
  doc: number,
  index: number,
  geometry: boolean,
): { width: number; height: number; text: string; charBoxes: DesktopPdfCharBox[] } {
  const page = m._FPDF_LoadPage(doc, index);
  if (!page) return { width: 0, height: 0, text: "", charBoxes: [] };
  try {
    const width = m._FPDF_GetPageWidthF(page);
    const height = m._FPDF_GetPageHeightF(page);
    const textPage = m._FPDFText_LoadPage(page);
    if (!textPage) return { width, height, text: "", charBoxes: [] };
    try {
      const count = m._FPDFText_CountChars(textPage);
      if (count <= 0) return { width, height, text: "", charBoxes: [] };
      // GetText writes count units AND the trailing NUL: one extra unit.
      const buf = m._malloc((count + 1) * 2);
      if (!buf) return { width, height, text: "", charBoxes: [] };
      let raw: string;
      try {
        const written = m._FPDFText_GetText(textPage, 0, count, buf);
        if (written <= 0) return { width, height, text: "", charBoxes: [] };
        raw = Buffer.from(m.HEAPU8.subarray(buf, buf + written * 2)).toString("utf16le").replace(/\0+$/, "");
      } finally {
        m._free(buf);
      }
      const { text, rawIndex } = normalizePageText(raw);
      if (!geometry || rawIndex.length === 0) return { width, height, text, charBoxes: [] };
      const rotation = pageRotation(m, page);
      // _FPDF_GetPageHeightF already swaps width/height for /Rotate 90 or 270,
      // so the UNROTATED box is display height x display width there.
      const unrotatedHeight = rotation === 1 || rotation === 3 ? width : height;
      const unrotatedWidth = rotation === 1 || rotation === 3 ? height : width;
      const rectPtr = m._malloc(16);
      const xPtr = m._malloc(8);
      const yPtr = m._malloc(8);
      try {
        if (!rectPtr || !xPtr || !yPtr) return { width, height, text, charBoxes: [] };
        const charBoxes: DesktopPdfCharBox[] = [];
        for (const rawCharIndex of rawIndex) {
          if (m._FPDFText_GetLooseCharBox(textPage, rawCharIndex, rectPtr)) {
            const left = m.HEAPF32[rectPtr >> 2]!;
            const top = m.HEAPF32[(rectPtr >> 2) + 1]!;
            const right = m.HEAPF32[(rectPtr >> 2) + 2]!;
            const bottom = m.HEAPF32[(rectPtr >> 2) + 3]!;
            charBoxes.push(toDisplayBox({ x: left, y: unrotatedHeight - top, width: right - left, height: top - bottom }, rotation, unrotatedWidth, unrotatedHeight));
            continue;
          }
          // No box: keep the offset aligned with a zero-size box.
          let x = 0;
          let y = 0;
          if (m._FPDFText_GetCharOrigin(textPage, rawCharIndex, xPtr, yPtr)) {
            x = m.HEAPF64[xPtr >> 3]!;
            y = unrotatedHeight - m.HEAPF64[yPtr >> 3]!;
          }
          charBoxes.push(toDisplayBox({ x, y, width: 0, height: 0 }, rotation, unrotatedWidth, unrotatedHeight));
        }
        return { width, height, text, charBoxes };
      } finally {
        if (rectPtr) m._free(rectPtr);
        if (xPtr) m._free(xPtr);
        if (yPtr) m._free(yPtr);
      }
    } finally {
      m._FPDFText_ClosePage(textPage);
    }
  } finally {
    m._FPDF_ClosePage(page);
  }
}

/** A bounded range of pages' text, optionally with display-space char boxes. This
 * is the desktop lane's find producer. The whole range is read in ONE
 * chainPdfium turn over ONE document load (the caller caps the range), so queued
 * renders and edits interleave between ranges instead of stalling behind a
 * whole-document read. `null` means `pageIndex` is past the last page; the range
 * clamps at the last page, and a page pdfium cannot load answers empty text. */
export function readPdfTextRange(
  bytes: Uint8Array,
  pageIndex: number,
  options: { pageLimit?: number; geometry?: boolean; password?: string; retainedKey?: string } = {},
): Promise<{ pageCount: number; pages: DesktopPdfTextPage[] } | null> {
  return chainPdfium(async () => {
    const m = await loadPdfium();
    assertRotationAware(m);
    return withRenderedDocument(m, bytes, options.password, async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc);
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return null;
      const end = Math.min(pageIndex + (options.pageLimit ?? 1), pageCount);
      const pages: DesktopPdfTextPage[] = [];
      for (let index = pageIndex; index < end; index += 1) {
        const read = readPageText(m, doc, index, options.geometry === true);
        pages.push({ page: index + 1, width: read.width, height: read.height, text: read.text, charBoxes: read.charBoxes });
      }
      return { pageCount, pages };
    }, options.retainedKey);
  });
}
