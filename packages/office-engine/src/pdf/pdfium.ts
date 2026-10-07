// PDFium WASM seam — ported from office-upstream apps/pdf/src/main/text-edit.ts
// (module interface, loader, chain, withDocument, saveDoc) and wasm-path.ts.
// Asset resolution: $UNIWORK_PDF_ASSETS when the runtime image stages the
// assets, the bundle-relative ./pdf-assets fallback when the job worker's env
// whitelist hides the variable, and package-relative require.resolve in the
// workspace/dev tree.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FPDF_PAGEOBJ_TEXT = 1;
export const FPDF_PAGEOBJ_IMAGE = 3;
export const FPDF_FONT_TYPE1 = 1;
export const FPDF_FONT_TRUETYPE = 2;
export const FPDF_TEXTRENDERMODE_FILL_STROKE = 2;
export const FPDF_TEXTRENDERMODE_FILL_STROKE_CLIP = 6;
export const FPDF_LINEJOIN_ROUND = 1;
export const FPDF_BITMAP_BGRA = 4;

/** Emscripten module surface we call into (raw FPDF_* exports + heap access) */
export interface Pdfium {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _PDFiumExt_Init(): void;
  _PDFiumExt_OpenFileWriter(): number;
  _PDFiumExt_SaveAsCopy(doc: number, writer: number): number;
  _PDFiumExt_GetFileWriterSize(writer: number): number;
  _PDFiumExt_GetFileWriterData(writer: number, buf: number, size: number): number;
  _PDFiumExt_CloseFileWriter(writer: number): void;
  _FPDF_LoadMemDocument(ptr: number, size: number, password: number): number;
  _FPDF_GetLastError(): number;
  _FPDF_CloseDocument(doc: number): void;
  _FPDF_LoadPage(doc: number, index: number): number;
  _FPDF_ClosePage(page: number): void;
  _FPDF_GetPageCount(doc: number): number;
  _FPDFText_LoadPage(page: number): number;
  _FPDFText_ClosePage(textPage: number): void;
  _FPDFText_CountChars(textPage: number): number;
  /** embedpdf's build drops buffer_size: it copies exactly `count` chars into `buffer` */
  _FPDFText_GetText(textPage: number, startIndex: number, count: number, buffer: number): number;
  _FPDF_GetMetaText(doc: number, tag: number, buffer: number, bufferLen: number): number;
  _FPDFText_GetTextObject(textPage: number, index: number): number;
  _FPDFText_GetLooseCharBox(textPage: number, index: number, rect: number): number;
  _FPDFText_GetCharOrigin(textPage: number, index: number, x: number, y: number): number;
  _FPDFText_LoadFont(doc: number, data: number, size: number, fontType: number, cid: number): number;
  _FPDFText_SetText(textObj: number, text: number): number;
  _FPDFPage_CountObjects(page: number): number;
  _FPDFPage_GetObject(page: number, index: number): number;
  _FPDFPage_RemoveObject(page: number, obj: number): number;
  _FPDFPage_InsertObject(page: number, obj: number): void;
  _FPDFPage_InsertObjectAtIndex?(page: number, obj: number, index: number): number;
  _FPDFPage_GenerateContent(page: number): number;
  _FPDFPageObj_GetType(obj: number): number;
  _FPDFPageObj_Destroy(obj: number): void;
  _FPDFPageObj_GetBounds(obj: number, l: number, b: number, r: number, t: number): number;
  _FPDFPageObj_GetMatrix(obj: number, matrix: number): number;
  _FPDFPageObj_SetMatrix(obj: number, matrix: number): number;
  _FPDFPageObj_GetFillColor(obj: number, r: number, g: number, b: number, a: number): number;
  _FPDFPageObj_SetFillColor(obj: number, r: number, g: number, b: number, a: number): number;
  _FPDFPageObj_GetStrokeColor(obj: number, r: number, g: number, b: number, a: number): number;
  _FPDFPageObj_SetStrokeColor(obj: number, r: number, g: number, b: number, a: number): number;
  _FPDFPageObj_GetStrokeWidth(obj: number, width: number): number;
  _FPDFPageObj_SetStrokeWidth(obj: number, width: number): number;
  _FPDFPageObj_SetLineJoin(obj: number, join: number): number;
  _FPDFTextObj_GetTextRenderMode(obj: number): number;
  _FPDFTextObj_SetTextRenderMode(obj: number, mode: number): number;
  _FPDFPageObj_CreateTextObj(doc: number, font: number, size: number): number;
  _FPDFTextObj_GetText(obj: number, textPage: number, buf: number, len: number): number;
  _FPDFTextObj_GetFont(obj: number): number;
  _FPDFTextObj_GetFontSize(obj: number, size: number): number;
  _FPDFFont_GetIsEmbedded(font: number): number;
  _FPDFFont_GetFontData(font: number, buffer: number, buflen: number, outBuflen: number): number;
  _FPDFFont_GetGlyphWidth(font: number, glyph: number, fontSize: number, width: number): number;
  _FPDFFont_GetBaseFontName(font: number, buffer: number, buflen: number): number;
  _FPDFFont_GetFamilyName(font: number, buffer: number, buflen: number): number;
  _FPDFPageObj_Transform(
    obj: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  _FPDFPageObj_NewImageObj(doc: number): number;
  _FPDFImageObj_SetBitmap(pages: number, count: number, obj: number, bitmap: number): number;
  _FPDFImageObj_GetRenderedBitmap(doc: number, page: number, obj: number): number;
  _FPDFBitmap_CreateEx(w: number, h: number, format: number, buf: number, stride: number): number;
  _FPDFBitmap_FillRect(
    bitmap: number,
    left: number,
    top: number,
    width: number,
    height: number,
    color: number,
  ): void;
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
  _FPDF_GetPageWidthF(page: number): number;
  _FPDF_GetPageHeightF(page: number): number;
  _FPDFBitmap_Destroy(bitmap: number): void;
  _FPDFBitmap_GetBuffer(bitmap: number): number;
  _FPDFBitmap_GetWidth(bitmap: number): number;
  _FPDFBitmap_GetHeight(bitmap: number): number;
  _FPDFBitmap_GetStride(bitmap: number): number;
  // Annotation access (annots.ts); EPDF_* are embedpdf extensions
  _FPDFPage_GetAnnotCount(page: number): number;
  _FPDFPage_GetAnnot(page: number, index: number): number;
  _FPDFPage_CloseAnnot(annot: number): void;
  _FPDFPage_RemoveAnnot(page: number, index: number): number;
  _FPDFAnnot_GetSubtype(annot: number): number;
  _FPDFAnnot_GetRect(annot: number, rect: number): number;
  _FPDFAnnot_GetStringValue(annot: number, key: number, buffer: number, buflen: number): number;
  _EPDFPage_GetAnnotByObjectNumber(page: number, objNum: number): number;
  _EPDFPage_RemoveAnnotByObjectNumber(page: number, objNum: number): number;
}

const req = () => createRequire(import.meta.url);

/** Asset root the runtime image provides: the service bundle ships no
    node_modules, so the Dockerfile stages wasm + fonts here and sets the var.
    Dev/tests resolve everything package-relative instead. The job worker's
    env is a whitelist (apps/office-engine supervisor.ts), so the variable can
    be absent inside a job even when the image set it: the bundle-relative
    asset dir (dist/pdf-assets -> /app/pdf-assets) is the fallback. */
function assetDir(): string | null {
  const dir = process.env.UNIWORK_PDF_ASSETS;
  if (dir && existsSync(dir)) return dir;
  try {
    const beside = fileURLToPath(new URL("./pdf-assets", import.meta.url));
    if (existsSync(beside)) return beside;
  } catch {
    /* not a file URL context: source checkouts use the package-relative paths */
  }
  return null;
}

function assetFile(name: string): string | null {
  const dir = assetDir();
  if (!dir) return null;
  const p = join(dir, name);
  return existsSync(p) ? p : null;
}

function pdfiumWasmPath(): string {
  return assetFile("pdfium.wasm") ?? req().resolve("@embedpdf/pdfium/pdfium.wasm");
}

/** harfbuzzjs ≥1.x seals subpaths; the subset wasm sits next to the exported
    entry point at dist/harfbuzz-subset.wasm (the layout this lane pins: 1.6.2). */
export function hbSubsetWasmPath(): string {
  const staged = assetFile("harfbuzz-subset.wasm");
  if (staged) return staged;
  const entry = req().resolve("harfbuzzjs");
  const p = join(dirname(entry), "harfbuzz-subset.wasm");
  if (existsSync(p)) return p;
  // ≤0.10 layout fallback: wasm at the package root with no exports map
  return req().resolve("harfbuzzjs/hb-subset.wasm");
}

/** The bundled OFL font dir (assets/fonts in dev, $UNIWORK_PDF_ASSETS/fonts in
    the image); prepended to the font-locate scan roots. */
export function bundledFontDir(): string | null {
  const dir = assetDir();
  if (dir) {
    const fonts = join(dir, "fonts");
    if (existsSync(fonts)) return fonts;
  }
  // Source checkout: this module lives at packages/office-engine/src/pdf/, so
  // ../../assets/fonts is the package-relative font dir.
  try {
    const src = fileURLToPath(new URL("../../assets/fonts", import.meta.url));
    if (existsSync(src)) return src;
  } catch {
    /* bundled context without the repo tree — env dir covers it */
  }
  return null;
}

let pdfiumPromise: Promise<Pdfium> | null = null;

/** Load the wasm bytes ourselves: the service worker must not rely on
    emscripten's __dirname-based lookup. */
export function loadPdfium(): Promise<Pdfium> {
  pdfiumPromise ??= (async () => {
    const { init } = (await import("@embedpdf/pdfium")) as unknown as {
      init(overrides: object): Promise<{ pdfium: Pdfium } | Pdfium>;
    };
    const raw = readFileSync(pdfiumWasmPath());
    // Exact slice: Buffer.buffer may be a shared pool larger than the file
    const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    // thisProgram: emscripten synthesizes an environ whose `_` entry defaults
    // to process.argv[1] and writes it through ASCII-asserting stringToAscii,
    // so a non-ASCII path in argv aborts the runtime at first use. A fixed
    // ASCII program name defuses the only variable entry.
    const wrapped = await init({ wasmBinary, thisProgram: "uniwork-pdf" });
    const m = ("pdfium" in wrapped ? wrapped.pdfium : wrapped) as Pdfium;
    m._PDFiumExt_Init();
    return m;
  })();
  return pdfiumPromise;
}

export function saveDoc(m: Pdfium, doc: number): Uint8Array {
  const writer = m._PDFiumExt_OpenFileWriter();
  try {
    if (!m._PDFiumExt_SaveAsCopy(doc, writer)) throw new Error("PDFium SaveAsCopy failed");
    const size = m._PDFiumExt_GetFileWriterSize(writer);
    const buf = m._malloc(size);
    if (!buf) throw new PdfOpenError("heap");
    m._PDFiumExt_GetFileWriterData(writer, buf, size);
    const out = Uint8Array.from(m.HEAPU8.subarray(buf, buf + size));
    m._free(buf);
    return out;
  } finally {
    m._PDFiumExt_CloseFileWriter(writer);
  }
}

/** The wasm instance is a shared singleton with global heap state; edits must
    not interleave. */
let applyChain: Promise<unknown> = Promise.resolve();

/** Serialize a pdfium operation behind every previously queued one. */
export function chainPdfium<T>(fn: () => Promise<T>): Promise<T> {
  const run = applyChain.then(fn);
  applyChain = run.catch(() => undefined);
  return run;
}

/** FPDF_GetLastError codes we classify (fpdfview.h). */
export const FPDF_ERR_PASSWORD = 4;
/** A security handler the build cannot satisfy with a password — a
    certificate-encrypted document answers this even with no password. */
export const FPDF_ERR_SECURITY = 5;

/** A document pdfium refused to open — the adapter maps this to a typed
    corrupt/encrypted refusal instead of engine_crashed. */
export class PdfOpenError extends Error {
  /** FPDF_GetLastError code, or "heap" when the input copy could not be made. */
  readonly detail: number | "heap";
  constructor(detail: number | "heap") {
    super(detail === "heap" ? "pdfium heap exhausted" : "pdfium load failed, fpdf_err=" + detail);
    this.name = "PdfOpenError";
    this.detail = detail;
  }
}

/** A pdfium document loaded from a heap copy of its bytes; both stay
    allocated until closeDocument. */
export interface OpenedDocument {
  readonly doc: number;
  readonly docPtr: number;
}

/**
 * Load `bytes` into pdfium. An encrypted document is opened with `password`
 * when one is supplied (pdfium performs the decryption; this build never
 * writes decrypted bytes anywhere). The password is UTF-8 + NUL terminated into
 * the wasm heap for the load call only, then wiped and freed before this
 * returns — it is never kept, echoed back or logged. The caller owns the
 * result and must hand it to closeDocument.
 */
export function openDocument(m: Pdfium, bytes: Uint8Array, password?: string): OpenedDocument {
  const docPtr = m._malloc(bytes.length);
  if (!docPtr) throw new PdfOpenError("heap");
  m.HEAPU8.set(bytes, docPtr);
  let passwordPtr = 0;
  let passwordSize = 0;
  if (password !== undefined) {
    const encoded = new TextEncoder().encode(password);
    passwordSize = encoded.length + 1;
    passwordPtr = m._malloc(passwordSize);
    if (!passwordPtr) {
      m._free(docPtr);
      throw new PdfOpenError("heap");
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
    throw new PdfOpenError(err);
  }
  return { doc, docPtr };
}

/** Close a document openDocument loaded and free its heap copy. */
export function closeDocument(m: Pdfium, opened: OpenedDocument): void {
  m._FPDF_CloseDocument(opened.doc);
  m._free(opened.docPtr);
}

/** Open `bytes` (see openDocument), run `fn` on the document pointer, and
 * close it however `fn` settles. */
export async function withDocument<T>(
  m: Pdfium,
  bytes: Uint8Array,
  fn: (doc: number) => Promise<T>,
  password?: string,
): Promise<T> {
  const opened = openDocument(m, bytes, password);
  try {
    return await fn(opened.doc);
  } finally {
    closeDocument(m, opened);
  }
}
