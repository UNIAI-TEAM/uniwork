// Node-side page rasterisation for the desktop PDF lane. The wasm pdfium seam
// (src/pdf/pdfium.ts) is shared with the text/edit paths, so every call here is
// queued behind chainPdfium: the module is one global heap and a render must not
// interleave with an edit. Nothing here writes back to the document — the input
// bytes are only read, and every pdfium pointer is released in a finally block.
import { PdfPasswordError, PdfTypedError } from "../pdf/adapter.ts";
import { encodeBgraToPng } from "../pdf/codec.ts";
import { chainPdfium, FPDF_BITMAP_BGRA, FPDF_ERR_PASSWORD, FPDF_ERR_SECURITY, loadPdfium, PdfOpenError, withDocument, type Pdfium } from "../pdf/pdfium.ts";

/** Open `bytes` in pdfium and run `fn`, mapping a load failure to the same
 * typed refusal the open/edit lane answers: a password wall is
 * PdfPasswordError (so the host can return it as data), a security handler a
 * password cannot satisfy is a named refusal, and any other load failure is
 * corruption. A heap failure is engine-side and rethrows. */
async function withRenderedDocument<T>(
  m: Pdfium,
  bytes: Uint8Array,
  password: string | undefined,
  fn: (doc: number) => Promise<T>,
): Promise<T> {
  try {
    return await withDocument(m, bytes, fn, password);
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
    });
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
