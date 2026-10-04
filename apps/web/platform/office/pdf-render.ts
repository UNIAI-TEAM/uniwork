import {
  loadBrowserPdfium,
  type BrowserPdfDocument,
  type BrowserPdfium,
  type BrowserPdfRenderedPage,
} from "@uniwork/office-engine/browser";
import type {
  PdfCanvasPage,
  PdfPageRenderService,
  PdfRenderPageRequest,
  PdfRenderResult,
} from "@uniwork/views/office/pdf";

/** Served from apps/web/public by scripts/copy-pdfium-wasm.mjs. */
export const PDFIUM_WASM_URL = "/office/pdfium.wasm";

const MAX_PIXEL_RATIO = 3;

export interface PdfRenderSession extends PdfPageRenderService {
  /**
   * pageNumber is 1-based; width/height are points in display orientation: the
   * engine reports the /Rotate-applied size, so a rotated page's box already
   * has its long edge on the matching axis and `rotation` stays 0 (the raster
   * is likewise pre-rotated). Overlays that want the page-own orientation can
   * still flip the axes through the reported `rotation`.
   */
  pages(): PdfCanvasPage[];
  pageText(pageNumber: number): string;
  /** Swap the document after an edit; drops cached images and revokes their object URLs. */
  replaceBytes(bytes: Uint8Array): Promise<void>;
  dispose(): void;
}

export interface PdfRenderDeps {
  loadPdfium?: () => Promise<BrowserPdfium>;
  toImageUrl?: (page: BrowserPdfRenderedPage) => Promise<string>;
  revokeImageUrl?: (url: string) => void;
  /** Required only for an encrypted document; pdfium answers password_required without one. */
  password?: string;
}

function abortError(): DOMException {
  return new DOMException("The pdf render was aborted", "AbortError");
}

async function canvasImageUrl(page: BrowserPdfRenderedPage): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("pdf_render_canvas_unavailable");
  // Copy into a fresh ArrayBuffer-backed array: ImageData rejects shared buffers.
  context.putImageData(new ImageData(new Uint8ClampedArray(page.data), page.width, page.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("pdf_render_encode_failed");
  return URL.createObjectURL(blob);
}

function pixelRatio(): number {
  const ratio = globalThis.devicePixelRatio;
  return Math.min(MAX_PIXEL_RATIO, ratio && ratio > 0 ? ratio : 1);
}

export async function createPdfRenderSession(
  bytes: Uint8Array,
  deps: PdfRenderDeps = {},
): Promise<PdfRenderSession> {
  const loadPdfium = deps.loadPdfium ?? (() => loadBrowserPdfium({ wasmUrl: PDFIUM_WASM_URL }));
  const toImageUrl = deps.toImageUrl ?? canvasImageUrl;
  const revokeImageUrl = deps.revokeImageUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const pdfium = await loadPdfium();
  const password = deps.password;

  let doc: BrowserPdfDocument | null = pdfium.openDocument(bytes, password);
  let version = 0;
  let disposed = false;
  // Cache holds in-flight and settled renders; every url is revoked on swap.
  let cache = new Map<string, Promise<string>>();

  const requireDoc = (): BrowserPdfDocument => {
    if (disposed || !doc) throw new Error("pdf_render_disposed");
    return doc;
  };

  const revokeAll = (): void => {
    const stale = cache;
    cache = new Map();
    for (const pending of stale.values()) {
      // A render still in flight revokes its url once it settles.
      void pending.then(revokeImageUrl, () => undefined);
    }
  };

  const pageIndex = (pageNumber: number, document: BrowserPdfDocument): number => {
    const index = pageNumber - 1;
    if (!Number.isInteger(index) || index < 0 || index >= document.pageCount) {
      throw new Error("pdf_render_page_out_of_range");
    }
    return index;
  };

  const renderPage = async (request: PdfRenderPageRequest): Promise<PdfRenderResult> => {
    if (request.signal?.aborted) throw abortError();
    const document = requireDoc();
    const index = pageIndex(request.pageNumber, document);
    const size = document.pageSize(index);
    // dpr is part of the key: moving between 1x/2x displays must not reuse a
    // stale-density bitmap until the next version bump.
    const key = `${request.pageNumber}@${request.scale}@${pixelRatio()}@${version}`;
    let pending = cache.get(key);
    if (!pending) {
      const rendered = document.renderPage(index, { scale: request.scale * pixelRatio() });
      const created = toImageUrl(rendered);
      pending = created;
      cache.set(key, created);
      // A failed render must not poison the cache.
      created.catch(() => {
        if (cache.get(key) === created) cache.delete(key);
      });
    }
    const src = await pending;
    if (request.signal?.aborted) throw abortError();
    if (disposed) throw new Error("pdf_render_disposed");
    return { src, width: size.width * request.scale, height: size.height * request.scale };
  };

  return {
    renderPage,
    pages() {
      const document = requireDoc();
      const result: PdfCanvasPage[] = [];
      for (let index = 0; index < document.pageCount; index += 1) {
        const size = document.pageSize(index);
        result.push({ pageNumber: index + 1, width: size.width, height: size.height, rotation: 0 });
      }
      return result;
    },
    pageText(pageNumber) {
      const document = requireDoc();
      return document.pageText(pageIndex(pageNumber, document));
    },
    async replaceBytes(next) {
      requireDoc();
      // Open first: a bad document leaves the current one usable.
      const opened = pdfium.openDocument(next, password);
      if (disposed) {
        opened.close();
        throw new Error("pdf_render_disposed");
      }
      const previous = doc;
      doc = opened;
      version += 1;
      revokeAll();
      previous?.close();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revokeAll();
      doc?.close();
      doc = null;
    },
  };
}
