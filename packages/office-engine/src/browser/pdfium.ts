// Browser pdfium: render + text only, over @embedpdf/pdfium's wasm build. The
// Node pdfium seam (src/pdf/pdfium.ts) reaches node:fs, so it is off limits for
// this graph: the wasm bytes arrive through a host-given URL and fetch, and the
// FPDF surface this file calls is declared locally.

const FPDF_ANNOT = 0x01;
const FPDF_BITMAP_BGRA = 4;
const FPDF_ERR_PASSWORD = 4;

/** The slice of the emscripten module this file calls into. */
export interface BrowserPdfiumModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _PDFiumExt_Init(): void;
  _FPDF_LoadMemDocument(ptr: number, size: number, password: number): number;
  _FPDF_GetLastError(): number;
  _FPDF_CloseDocument(doc: number): void;
  _FPDF_LoadPage(doc: number, index: number): number;
  _FPDF_ClosePage(page: number): void;
  _FPDF_GetPageCount(doc: number): number;
  _FPDF_GetPageWidthF(page: number): number;
  _FPDF_GetPageHeightF(page: number): number;
  _FPDFBitmap_CreateEx(w: number, h: number, format: number, buf: number, stride: number): number;
  _FPDFBitmap_FillRect(bitmap: number, left: number, top: number, width: number, height: number, color: number): void;
  _FPDFBitmap_Destroy(bitmap: number): void;
  _FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number,
  ): void;
  _FPDFText_LoadPage(page: number): number;
  _FPDFText_ClosePage(textPage: number): void;
  _FPDFText_CountChars(textPage: number): number;
  /** embedpdf's build drops buffer_size: it copies exactly `count` chars (+ NUL) into `buffer`. */
  _FPDFText_GetText(textPage: number, startIndex: number, count: number, buffer: number): number;
  /** FS_RECTF* (4 floats: left, top, right, bottom) in PDF points. */
  _FPDFText_GetLooseCharBox(textPage: number, index: number, rect: number): number;
  /** FPDFText_GetCharOrigin: writes two doubles (x, y) in PDF points. */
  _FPDFText_GetCharOrigin(textPage: number, index: number, x: number, y: number): number;
}

export interface BrowserPdfRenderedPage {
  /** RGBA, row-major, width * height * 4 bytes. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface BrowserPdfDocument {
  readonly pageCount: number;
  /** Page size in points, 0-based index. */
  pageSize(index: number): { width: number; height: number };
  /** Pixel size = round(points * scale); annotations are drawn (FPDF_ANNOT). */
  renderPage(index: number, options: { scale: number }): BrowserPdfRenderedPage;
  /** Text of the page; line breaks are normalised to \n. */
  pageText(index: number): string;
  /** One box per character of pageText(index), in that same index space: a
   * top-left-origin rectangle in PDF points. A char with no box is reported
   * as a zero-size box so offsets stay aligned with pageText. */
  pageCharBoxes(index: number): readonly { x: number; y: number; width: number; height: number }[];
  close(): void;
}

export interface BrowserPdfium {
  /** Throws BrowserPdfOpenError. */
  openDocument(bytes: Uint8Array, password?: string): BrowserPdfDocument;
}

export type BrowserPdfOpenErrorCode = "password_required" | "wrong_password" | "engine_error";

export class BrowserPdfOpenError extends Error {
  readonly code: BrowserPdfOpenErrorCode;
  constructor(code: BrowserPdfOpenErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BrowserPdfOpenError";
    this.code = code;
  }
}

function withPage<T>(m: BrowserPdfiumModule, doc: number, index: number, fn: (page: number) => T): T {
  const page = m._FPDF_LoadPage(doc, index);
  if (!page) throw new Error(`pdfium cannot load page ${index}`);
  try {
    return fn(page);
  } finally {
    m._FPDF_ClosePage(page);
  }
}

function readUtf16(m: BrowserPdfiumModule, ptr: number, units: number): string {
  const view = m.HEAPU8.subarray(ptr, ptr + units * 2);
  return new TextDecoder("utf-16le").decode(view);
}

/** Whole-textpage text (UTF-16LE, NUL-trimmed) exactly as pdfium reports it. */
function readRawPageText(m: BrowserPdfiumModule, textPage: number): string {
  const count = m._FPDFText_CountChars(textPage);
  if (count <= 0) return "";
  // GetText writes `count` units AND the trailing NUL: one extra unit.
  const buf = m._malloc((count + 1) * 2);
  if (!buf) return "";
  try {
    const written = m._FPDFText_GetText(textPage, 0, count, buf);
    if (written <= 0) return "";
    return readUtf16(m, buf, written).replace(/\0+$/, "");
  } finally {
    m._free(buf);
  }
}

/** Normalise a raw textpage string the way pageText does, keeping the mapping
 * from each normalised character back to its raw char index so char boxes stay
 * in the same index space as pageText (pdfium emits \r\n, pageText emits \n). */
function normalizePageText(raw: string): { text: string; rawIndex: number[] } {
  let text = "";
  const rawIndex: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (ch === "\r") {
      // \r\n and a lone \r both collapse to one \n (the \n is skipped).
      text += "\n";
      rawIndex.push(i);
      if (raw[i + 1] === "\n") i += 1;
    } else {
      text += ch;
      rawIndex.push(i);
    }
  }
  // pageText trims trailing whitespace; drop the same tail from the map.
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1]!)) end -= 1;
  return { text: text.slice(0, end), rawIndex: rawIndex.slice(0, end) };
}

/** Wrap an initialised module. Exported for tests that inject a fake module. */
export function createBrowserPdfium(m: BrowserPdfiumModule): BrowserPdfium {
  return {
    openDocument(bytes, password) {
      const docPtr = m._malloc(bytes.length);
      if (!docPtr) throw new BrowserPdfOpenError("engine_error", "pdfium heap exhausted");
      m.HEAPU8.set(bytes, docPtr);
      let passwordPtr = 0;
      let passwordSize = 0;
      if (password !== undefined) {
        const encoded = new TextEncoder().encode(password);
        passwordSize = encoded.length + 1;
        passwordPtr = m._malloc(passwordSize);
        if (!passwordPtr) {
          m._free(docPtr);
          throw new BrowserPdfOpenError("engine_error", "pdfium heap exhausted");
        }
        m.HEAPU8.set(encoded, passwordPtr);
        m.HEAPU8[passwordPtr + encoded.length] = 0;
      }
      let doc = 0;
      try {
        doc = m._FPDF_LoadMemDocument(docPtr, bytes.length, passwordPtr);
      } finally {
        if (passwordPtr) {
          m.HEAPU8.fill(0, passwordPtr, passwordPtr + passwordSize);
          m._free(passwordPtr);
        }
      }
      if (!doc) {
        const err = m._FPDF_GetLastError();
        m._free(docPtr);
        if (err === FPDF_ERR_PASSWORD) {
          throw new BrowserPdfOpenError(password === undefined ? "password_required" : "wrong_password");
        }
        throw new BrowserPdfOpenError("engine_error", `pdfium load failed, fpdf_err=${err}`);
      }
      const pageCount = m._FPDF_GetPageCount(doc);
      let closed = false;
      const live = (): void => {
        if (closed) throw new Error("pdfium document is closed");
      };
      return {
        pageCount,
        pageSize(index) {
          live();
          return withPage(m, doc, index, (page) => ({
            width: m._FPDF_GetPageWidthF(page),
            height: m._FPDF_GetPageHeightF(page),
          }));
        },
        renderPage(index, { scale }) {
          live();
          return withPage(m, doc, index, (page) => {
            const width = Math.max(1, Math.round(m._FPDF_GetPageWidthF(page) * scale));
            const height = Math.max(1, Math.round(m._FPDF_GetPageHeightF(page) * scale));
            const size = width * height * 4;
            const buf = m._malloc(size);
            if (!buf) throw new Error("pdfium heap exhausted");
            const bitmap = m._FPDFBitmap_CreateEx(width, height, FPDF_BITMAP_BGRA, buf, width * 4);
            if (!bitmap) {
              m._free(buf);
              throw new Error("pdfium cannot create a bitmap");
            }
            try {
              m._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
              m._FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT);
              // BGRA -> RGBA, copied out of the wasm heap before it is freed.
              const data = new Uint8ClampedArray(size);
              const heap = m.HEAPU8;
              for (let i = 0; i < size; i += 4) {
                data[i] = heap[buf + i + 2]!;
                data[i + 1] = heap[buf + i + 1]!;
                data[i + 2] = heap[buf + i]!;
                data[i + 3] = heap[buf + i + 3]!;
              }
              return { data, width, height };
            } finally {
              m._FPDFBitmap_Destroy(bitmap);
              m._free(buf);
            }
          });
        },
        pageText(index) {
          live();
          return withPage(m, doc, index, (page) => {
            const textPage = m._FPDFText_LoadPage(page);
            if (!textPage) return "";
            try {
              return normalizePageText(readRawPageText(m, textPage)).text;
            } finally {
              m._FPDFText_ClosePage(textPage);
            }
          });
        },
        pageCharBoxes(index) {
          live();
          return withPage(m, doc, index, (page) => {
            const textPage = m._FPDFText_LoadPage(page);
            if (!textPage) return [];
            try {
              const { rawIndex } = normalizePageText(readRawPageText(m, textPage));
              if (rawIndex.length === 0) return [];
              const pageHeight = m._FPDF_GetPageHeightF(page);
              const rectPtr = m._malloc(16);
              const xPtr = m._malloc(8);
              const yPtr = m._malloc(8);
              try {
                if (!rectPtr || !xPtr || !yPtr) return [];
                const boxes: { x: number; y: number; width: number; height: number }[] = [];
                for (const rawCharIndex of rawIndex) {
                  if (m._FPDFText_GetLooseCharBox(textPage, rawCharIndex, rectPtr)) {
                    const left = m.HEAPF32[rectPtr >> 2]!;
                    const top = m.HEAPF32[(rectPtr >> 2) + 1]!;
                    const right = m.HEAPF32[(rectPtr >> 2) + 2]!;
                    const bottom = m.HEAPF32[(rectPtr >> 2) + 3]!;
                    // PDF user space is bottom-left; report a top-left-origin box.
                    boxes.push({ x: left, y: pageHeight - top, width: right - left, height: top - bottom });
                    continue;
                  }
                  // No box: keep the offset aligned with a zero-size box.
                  let x = 0;
                  let y = 0;
                  if (m._FPDFText_GetCharOrigin(textPage, rawCharIndex, xPtr, yPtr)) {
                    x = m.HEAPF64[xPtr >> 3]!;
                    y = pageHeight - m.HEAPF64[yPtr >> 3]!;
                  }
                  boxes.push({ x, y, width: 0, height: 0 });
                }
                return boxes;
              } finally {
                if (rectPtr) m._free(rectPtr);
                if (xPtr) m._free(xPtr);
                if (yPtr) m._free(yPtr);
              }
            } finally {
              m._FPDFText_ClosePage(textPage);
            }
          });
        },
        close() {
          if (closed) return;
          closed = true;
          m._FPDF_CloseDocument(doc);
          m._free(docPtr);
        },
      };
    },
  };
}

const instances = new Map<string, Promise<BrowserPdfium>>();

/**
 * Load pdfium once per wasm URL. The wasm bytes are fetched here (never the
 * emscripten loader's own lookup), so the host only has to serve the file. A
 * failed load is not cached: the next call retries.
 */
export function loadBrowserPdfium(options: { wasmUrl: string; fetch?: typeof fetch }): Promise<BrowserPdfium> {
  const cached = instances.get(options.wasmUrl);
  if (cached) return cached;
  const loading = (async () => {
    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await doFetch(options.wasmUrl);
    if (!response.ok) throw new Error(`pdfium wasm fetch failed: ${response.status}`);
    const wasmBinary = await response.arrayBuffer();
    const { init } = (await import("@embedpdf/pdfium")) as unknown as {
      init(overrides: object): Promise<{ pdfium: BrowserPdfiumModule } | BrowserPdfiumModule>;
    };
    const wrapped = await init({ wasmBinary });
    const m = "pdfium" in wrapped ? wrapped.pdfium : wrapped;
    m._PDFiumExt_Init();
    return createBrowserPdfium(m);
  })();
  instances.set(options.wasmUrl, loading);
  loading.catch(() => {
    if (instances.get(options.wasmUrl) === loading) instances.delete(options.wasmUrl);
  });
  return loading;
}
