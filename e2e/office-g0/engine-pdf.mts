// DOC-003 engine host: PDF routes on the real upstream text/image engine.
//
// Text path (upstream apps/pdf/src/main/text-edit.ts):
//   validateTextEdits -> applyTextEdits -> verifyTextEdits, then a staged write.
//   savePdfToPath is deliberately NOT used: it re-applies the same edits, and
//   the renderer''s SavePdfRequest is split by the host so one stage owns them.
//
// Image path: upstream''s content-stream image ops (replaceImage/transformImage/
// deleteImage) live in apps/pdf/src/main/image-edit.ts, which statically imports
// Electron''s nativeImage. This host therefore carries its own decoder adapter:
// PNG bytes are decoded with pngjs (resolved from the prepared source tree) into
// straight-alpha BGRA, handed to pdfium''s _FPDFImageObj_SetBitmap, and the page
// content stream is regenerated. Nothing in this module imports Electron.
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FPDF_PAGEOBJ_IMAGE = 3;
const FPDF_BITMAP_BGRA = 4;
const FPDF_RENDER_FLAG_REVERSE_BYTE_ORDER = 0x01;
const MATCH_TOL = 2;

/** The subset of the pdfium wasm surface this host drives. */
export interface PdfiumLike {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  _FPDF_GetPageCount(doc: number): number;
  _FPDF_LoadPage(doc: number, index: number): number;
  _FPDF_ClosePage(page: number): void;
  _FPDF_GetPageWidthF(page: number): number;
  _FPDF_GetPageHeightF(page: number): number;
  _FPDFPage_CountObjects(page: number): number;
  _FPDFPage_GetObject(page: number, index: number): number;
  _FPDFPageObj_GetBounds(obj: number, l: number, b: number, r: number, t: number): boolean;
  _FPDFPageObj_GetType(obj: number): number;
  _FPDFImageObj_SetBitmap(pages: number, count: number, obj: number, bitmap: number): boolean;
  _FPDFPage_GenerateContent(page: number): boolean;
  _FPDFBitmap_Create(width: number, height: number, alpha: number): number;
  _FPDFBitmap_CreateEx(width: number, height: number, format: number, buffer: number, stride: number): number;
  _FPDFBitmap_FillRect(bitmap: number, x: number, y: number, width: number, height: number, color: number): void;
  _FPDFBitmap_GetBuffer(bitmap: number): number;
  _FPDFBitmap_GetStride(bitmap: number): number;
  _FPDFBitmap_Destroy(bitmap: number): void;
  _FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    x: number,
    y: number,
    width: number,
    height: number,
    rotate: number,
    flags: number,
  ): void;
}

export interface TextEditInputLike {
  pageIndex: number;
  rect: [number, number, number, number];
  oldText: string;
  newText: string;
  fontSize: number;
  [key: string]: unknown;
}

export interface ImageEditLike {
  kind: "replaceImage" | "transformImage" | "deleteImage" | "insertImage";
  pageIndex: number;
  oldRect?: [number, number, number, number];
  rect?: [number, number, number, number];
  image?: string;
  layer?: "belowText" | "aboveText";
  quarterTurns?: number;
  rotate?: number;
}

export interface PdfTextEditSummary {
  bytes: Uint8Array;
  skipped: { pageIndex: number; oldText: string; reason: string }[];
  failures: { pageIndex: number; reason: string }[];
  beforeText: string;
  afterText: string;
}

export interface PdfImageSummary {
  bytes: Uint8Array;
  decoder: string;
  width: number;
  height: number;
  renderedPixels: number;
  renderChanged: boolean;
}

export class PdfEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PdfEngineError";
    this.code = code;
  }
}

interface PngImage {
  width: number;
  height: number;
  data: Uint8Array;
}

interface PageObject {
  obj: number;
  index: number;
  type: number;
  bounds: [number, number, number, number];
}

interface RenderResult {
  bytes: Uint8Array;
  stride: number;
  height: number;
}

export interface PdfEngine {
  validateTextEdits(
    bytes: Uint8Array,
    edits: TextEditInputLike[],
  ): Promise<{ reason: string | null; bounds?: number[] }[]>;
  readPdfText(bytes: Uint8Array): Promise<{ pageCount: number; text: string }>;
  applyTextEdits(bytes: Uint8Array, edits: TextEditInputLike[]): Promise<PdfTextEditSummary>;
  listImages(bytes: Uint8Array): Promise<
    { pageIndex: number; rect: [number, number, number, number]; aboveText: boolean }[]
  >;
  replaceImage(
    bytes: Uint8Array,
    edit: ImageEditLike & { image: string; rect: [number, number, number, number] },
  ): Promise<PdfImageSummary>;
}

export async function createPdfEngine(sourceRoot: string): Promise<PdfEngine> {
  const load = (relative: string) =>
    import(pathToFileURL(join(sourceRoot, relative)).href) as Promise<Record<string, unknown>>;

  const textEdit = (await load("apps/pdf/src/main/text-edit.ts")) as {
    loadPdfium: () => Promise<PdfiumLike>;
    withDocument: <T>(m: PdfiumLike, bytes: Uint8Array, fn: (doc: number) => Promise<T>) => Promise<T>;
    chainPdfium: <T>(fn: () => Promise<T>) => Promise<T>;
    applyTextEdits: (
      bytes: Uint8Array,
      edits: TextEditInputLike[],
    ) => Promise<{
      bytes: Uint8Array;
      skipped: { pageIndex: number; oldText: string; reason: string }[];
    }>;
    validateTextEdits: (
      bytes: Uint8Array,
      edits: TextEditInputLike[],
    ) => Promise<{ reason: string | null; bounds?: number[] }[]>;
    verifyTextEdits: (
      bytes: Uint8Array,
      edits: { pageIndex: number; newText: string }[],
    ) => Promise<{ pageIndex: number; reason: string }[]>;
    saveDoc: (m: PdfiumLike, doc: number) => Uint8Array;
  };
  const readText = (await load("apps/pdf/src/main/read-text.ts")) as {
    readPdfText: (bytes: Uint8Array) => Promise<{ pageCount: number; pages: { text: string; chars: number }[] }>;
  };

  // pngjs is a devDependency at the prepared source root, so it never resolves
  // by bare name from this lab file: resolve it through the source package.json.
  const sourceRequire = createRequire(join(sourceRoot, "package.json"));
  let pngModule: { PNG: { sync: { read(data: Buffer): PngImage } } } | null = null;
  const loadPng = () => {
    if (pngModule) return pngModule;
    let resolved: string;
    try {
      resolved = sourceRequire.resolve("pngjs");
    } catch {
      throw new PdfEngineError(
        "image_decoder_missing",
        "PNG decoder unavailable: pngjs is not installed in the prepared source tree",
      );
    }
    pngModule = sourceRequire(resolved) as { PNG: { sync: { read(data: Buffer): PngImage } } };
    return pngModule;
  };

  const decodePng = (base64: string): { width: number; height: number; bgra: Buffer } => {
    const { PNG } = loadPng();
    let decoded: PngImage;
    try {
      decoded = PNG.sync.read(Buffer.from(base64, "base64"));
    } catch (error) {
      throw new PdfEngineError(
        "image_decode_failed",
        "PNG decode failed: " + (error instanceof Error ? error.message : String(error)),
      );
    }
    const bgra = Buffer.alloc(decoded.width * decoded.height * 4);
    for (let i = 0; i < decoded.data.length; i += 4) {
      bgra[i] = decoded.data[i + 2] ?? 0;
      bgra[i + 1] = decoded.data[i + 1] ?? 0;
      bgra[i + 2] = decoded.data[i] ?? 0;
      bgra[i + 3] = decoded.data[i + 3] ?? 255;
    }
    return { width: decoded.width, height: decoded.height, bgra };
  };

  const collectObjects = (m: PdfiumLike, page: number): PageObject[] => {
    const out: PageObject[] = [];
    const p = m._malloc(16);
    try {
      const count = m._FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) {
        const obj = m._FPDFPage_GetObject(page, i);
        if (!m._FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)) continue;
        out.push({
          obj,
          index: i,
          type: m._FPDFPageObj_GetType(obj),
          bounds: [
            m.HEAPF32[p >> 2] ?? 0,
            m.HEAPF32[(p + 4) >> 2] ?? 0,
            m.HEAPF32[(p + 8) >> 2] ?? 0,
            m.HEAPF32[(p + 12) >> 2] ?? 0,
          ],
        });
      }
    } finally {
      m._free(p);
    }
    return out;
  };

  const matchImage = (objects: PageObject[], rect: readonly number[]): PageObject | null => {
    let best: PageObject | null = null;
    let bestD = Infinity;
    for (const o of objects) {
      if (o.type !== FPDF_PAGEOBJ_IMAGE) continue;
      const d = Math.max(
        Math.abs(o.bounds[0] - (rect[0] ?? 0)),
        Math.abs(o.bounds[1] - (rect[1] ?? 0)),
        Math.abs(o.bounds[2] - (rect[2] ?? 0)),
        Math.abs(o.bounds[3] - (rect[3] ?? 0)),
      );
      if (d <= MATCH_TOL && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  };

  /** Rasterize one page at 2x so an image swap can be proven, not assumed. */
  const renderPage = (m: PdfiumLike, doc: number, pageIndex: number): RenderResult => {
    const page = m._FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new PdfEngineError("page_missing", "page does not exist: " + pageIndex);
    try {
      const width = Math.max(1, Math.round(m._FPDF_GetPageWidthF(page) * 2));
      const height = Math.max(1, Math.round(m._FPDF_GetPageHeightF(page) * 2));
      const bitmap = m._FPDFBitmap_Create(width, height, 1);
      if (!bitmap) throw new PdfEngineError("render_failed", "FPDFBitmap_Create failed");
      try {
        m._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        m._FPDF_RenderPageBitmap(
          bitmap,
          page,
          0,
          0,
          width,
          height,
          0,
          FPDF_RENDER_FLAG_REVERSE_BYTE_ORDER,
        );
        const buffer = m._FPDFBitmap_GetBuffer(bitmap);
        const stride = m._FPDFBitmap_GetStride(bitmap);
        return {
          bytes: Uint8Array.from(m.HEAPU8.subarray(buffer, buffer + stride * height)),
          stride,
          height,
        };
      } finally {
        m._FPDFBitmap_Destroy(bitmap);
      }
    } finally {
      m._FPDF_ClosePage(page);
    }
  };

  return {
    validateTextEdits: (bytes, edits) => textEdit.validateTextEdits(bytes, edits),

    async readPdfText(bytes) {
      const doc = await readText.readPdfText(bytes);
      return { pageCount: doc.pageCount, text: doc.pages.map((p) => p.text).join("\n") };
    },

    async applyTextEdits(bytes, edits) {
      if (edits.length === 0) {
        throw new PdfEngineError("empty_edits", "a PDF text save needs at least one text edit");
      }
      const validation = await textEdit.validateTextEdits(bytes, edits);
      const invalid = validation
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.reason !== null);
      if (invalid.length > 0) {
        throw new PdfEngineError(
          "text_edit_unmatched",
          "text edits would be skipped: " +
            JSON.stringify(invalid.map(({ entry, index }) => ({ index, reason: entry.reason }))),
        );
      }
      const applied = await textEdit.applyTextEdits(bytes, edits);
      if (applied.skipped.length > 0) {
        // Fail-soft upstream must not become a silent partial save in the lab.
        throw new PdfEngineError(
          "text_edit_skipped",
          "applyTextEdits skipped " + applied.skipped.length + " edit(s): " + JSON.stringify(applied.skipped),
        );
      }
      const failures = await textEdit.verifyTextEdits(
        applied.bytes,
        edits.map((edit) => ({ pageIndex: edit.pageIndex, newText: edit.newText })),
      );
      if (failures.length > 0) {
        throw new PdfEngineError(
          "text_verify_failed",
          "saved output does not contain the replacement text: " + JSON.stringify(failures),
        );
      }
      const before = await readText.readPdfText(bytes);
      const after = await readText.readPdfText(applied.bytes);
      return {
        bytes: applied.bytes,
        skipped: applied.skipped,
        failures,
        beforeText: before.pages.map((p) => p.text).join("\n"),
        afterText: after.pages.map((p) => p.text).join("\n"),
      };
    },

    async listImages(bytes) {
      return textEdit.chainPdfium(async () => {
        const m = await textEdit.loadPdfium();
        return textEdit.withDocument(m, bytes, async (doc) => {
          const out: { pageIndex: number; rect: [number, number, number, number]; aboveText: boolean }[] = [];
          const pageCount = m._FPDF_GetPageCount(doc);
          for (let index = 0; index < pageCount; index++) {
            const page = m._FPDF_LoadPage(doc, index);
            if (!page) continue;
            try {
              const objects = collectObjects(m, page);
              const textIndex = objects.find((o) => o.type === 1)?.index;
              for (const o of objects) {
                if (o.type !== FPDF_PAGEOBJ_IMAGE) continue;
                if (o.bounds[2] - o.bounds[0] < 3 || o.bounds[3] - o.bounds[1] < 3) continue;
                out.push({
                  pageIndex: index,
                  rect: o.bounds,
                  aboveText: textIndex !== undefined && o.index > textIndex,
                });
              }
            } finally {
              m._FPDF_ClosePage(page);
            }
          }
          return out;
        });
      });
    },

    async replaceImage(bytes, edit) {
      if (edit.kind !== "replaceImage") {
        throw new PdfEngineError("unsupported_image_op", "this host implements replaceImage only");
      }
      const decoded = decodePng(edit.image);
      const result = await textEdit.chainPdfium(async () => {
        const m = await textEdit.loadPdfium();
        return textEdit.withDocument(m, bytes, async (doc) => {
          const before = renderPage(m, doc, edit.pageIndex);
          const page = m._FPDF_LoadPage(doc, edit.pageIndex);
          if (!page) throw new PdfEngineError("page_missing", "page does not exist: " + edit.pageIndex);
          try {
            const target = matchImage(collectObjects(m, page), edit.oldRect ?? edit.rect ?? []);
            if (!target) return { located: false, out: bytes, renderedPixels: 0, renderChanged: false };
            const buffer = m._malloc(decoded.bgra.length);
            m.HEAPU8.set(decoded.bgra, buffer);
            const bitmap = m._FPDFBitmap_CreateEx(
              decoded.width,
              decoded.height,
              FPDF_BITMAP_BGRA,
              buffer,
              decoded.width * 4,
            );
            const pagePtr = m._malloc(4);
            m.HEAP32[pagePtr >> 2] = page;
            let ok = false;
            try {
              ok = !!m._FPDFImageObj_SetBitmap(pagePtr, 1, target.obj, bitmap);
            } finally {
              m._free(pagePtr);
              m._FPDFBitmap_Destroy(bitmap);
              m._free(buffer);
            }
            if (!ok) throw new PdfEngineError("image_set_bitmap_failed", "FPDFImageObj_SetBitmap failed");
            if (!m._FPDFPage_GenerateContent(page)) {
              throw new PdfEngineError("image_generate_failed", "FPDFPage_GenerateContent failed");
            }
            const out = textEdit.saveDoc(m, doc);
            const after = await textEdit.withDocument(m, out, async (doc2) => renderPage(m, doc2, edit.pageIndex));
            return {
              located: true,
              out,
              renderedPixels: after.bytes.length,
              renderChanged: Buffer.compare(Buffer.from(before.bytes), Buffer.from(after.bytes)) !== 0,
            };
          } finally {
            m._FPDF_ClosePage(page);
          }
        });
      });
      if (!result.located) {
        throw new PdfEngineError("image_not_found", "no content-stream image matches the given rect");
      }
      if (!result.renderChanged) {
        throw new PdfEngineError(
          "image_verify_failed",
          "the rendered page is byte-identical after the replace; the pixels did not change",
        );
      }
      return {
        bytes: result.out,
        decoder: "pngjs",
        width: decoded.width,
        height: decoded.height,
        renderedPixels: result.renderedPixels,
        renderChanged: result.renderChanged,
      };
    },
  };
}