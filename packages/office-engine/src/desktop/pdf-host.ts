// @uniwork/office-engine/desktop — the PDF host lane. The desktop main process
// owns pdfium/pdf-lib (Node only); the renderer reaches it through the typed
// `desktop:engine-call` payload and never imports this module (ADR 0021). The
// entries below are the whole lane: `open` probes the bytes into a view-safe
// page summary plus per-page sizes, `edit` applies one batch and returns the
// verified output bytes, `render` rasterises one page to a PNG, and `text` reads
// a page range's text layer (plus per-character display-space boxes on request) so the renderer can run
// find. Paths and file handles stay on the host side.
import { applyPdfEditBytes, PdfPasswordError, probePdf, type PdfEditOutcome, type PdfPasswordStatus, type PdfProbe } from "../pdf/index";
import { readPdfPageSizes, readPdfTextRange, renderPdfPagePng, type DesktopPdfTextPage } from "./pdf-render.ts";

/** Operations the IPC schema lets a caller name. `open`, `edit`, `render` and
 * `text` are bound; the rest answer `engine_operation_unsupported` before any
 * payload is read. */
export type DesktopEngineOperation = "open" | "edit" | "render" | "text" | "capability" | "serialize" | "cancel";

export interface DesktopEngineCall {
  readonly operation: DesktopEngineOperation;
  /** Opaque host handle; never a filesystem path. */
  readonly handle: string;
  readonly args: {
    readonly dataBase64?: unknown;
    readonly edits?: unknown;
    readonly password?: unknown;
    readonly pageIndex?: unknown;
    readonly pageLimit?: unknown;
    readonly geometry?: unknown;
    readonly scale?: unknown;
  };
}

/** One page's size in PDF points, in page order; a page pdfium could not load
 * reports zero. The renderer lays out one box per entry. */
export interface DesktopPdfPageSize {
  readonly width: number;
  readonly height: number;
}

export interface DesktopEngineOpenResult {
  readonly ok: true;
  readonly operation: "open";
  readonly probe: PdfProbe;
  readonly pageSizes: readonly DesktopPdfPageSize[];
}

export interface DesktopEngineEditResult {
  readonly ok: true;
  readonly operation: "edit";
  readonly dataBase64: string;
  readonly warnings: PdfEditOutcome["warnings"];
  readonly report: PdfEditOutcome["report"];
}

export interface DesktopEngineRenderResult {
  readonly ok: true;
  readonly operation: "render";
  /** Base64 PNG of the requested page at the requested scale. */
  readonly pngBase64: string;
  readonly width: number;
  readonly height: number;
}

/** A password wall is a typed answer, not a thrown error: an Electron IPC
 * rejection flattens to a generic Error, so the class travels as data and the
 * renderer can map it back to the password failure. */
export interface DesktopEnginePasswordRefusal {
  readonly ok: false;
  readonly error: { readonly kind: "password"; readonly status: PdfPasswordStatus };
}

/** A bounded page range of the text layer (`pageLimit` pages from `pageIndex`);
 * `charBoxes` is empty unless the call asked for `geometry`. The renderer walks
 * the document lazily, one range per call. */
export interface DesktopEngineTextResult {
  readonly ok: true;
  readonly operation: "text";
  readonly pageCount: number;
  readonly pages: readonly DesktopPdfTextPage[];
}

export type DesktopEngineCallResult = DesktopEngineOpenResult | DesktopEngineEditResult | DesktopEngineRenderResult | DesktopEngineTextResult | DesktopEnginePasswordRefusal;

/** Typed refusal for a malformed call: the IPC dispatcher turns a thrown
 * error into the channel's failure surface, so a missing payload never
 * fabricates an empty document. */
export class DesktopEngineCallError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("desktop engine call refused");
    this.name = "DesktopEngineCallError";
    this.code = code;
  }
}

/** Most pages one `text` call may read: bounds the single chainPdfium turn. */
const MAX_TEXT_PAGE_LIMIT = 32;

function decode(input: unknown): Uint8Array {
  if (typeof input !== "string") throw new DesktopEngineCallError("engine_input_missing");
  return Uint8Array.from(Buffer.from(input, "base64"));
}

async function dispatch(call: DesktopEngineCall): Promise<DesktopEngineCallResult> {
  if (call.operation === "open") {
    const bytes = decode(call.args.dataBase64);
    const password = typeof call.args.password === "string" ? call.args.password : undefined;
    // The probe is the gate: an encrypted document without the right password
    // must answer the typed wall before any size read touches pdfium.
    const probe = await probePdf(bytes, password);
    const pageSizes = await readPdfPageSizes(bytes, password);
    return { ok: true, operation: "open", probe, pageSizes };
  }
  if (call.operation === "edit") {
    const bytes = decode(call.args.dataBase64);
    if (!Array.isArray(call.args.edits)) throw new DesktopEngineCallError("engine_input_missing");
    const result = await applyPdfEditBytes(bytes, call.args.edits);
    return { ok: true, operation: "edit", dataBase64: Buffer.from(result.bytes).toString("base64"), warnings: result.warnings, report: result.report };
  }
  if (call.operation === "text") {
    const bytes = decode(call.args.dataBase64);
    const password = typeof call.args.password === "string" ? call.args.password : undefined;
    const pageIndex = call.args.pageIndex;
    if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) throw new DesktopEngineCallError("engine_input_missing");
    const pageLimit = call.args.pageLimit ?? 1;
    if (typeof pageLimit !== "number" || !Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_TEXT_PAGE_LIMIT) throw new DesktopEngineCallError("engine_input_missing");
    const result = await readPdfTextRange(bytes, pageIndex, { pageLimit, geometry: call.args.geometry === true, ...(password === undefined ? {} : { password }) });
    if (!result) throw new DesktopEngineCallError("engine_text_unavailable");
    return { ok: true, operation: "text", pageCount: result.pageCount, pages: result.pages };
  }
  if (call.operation === "render") {
    const bytes = decode(call.args.dataBase64);
    const pageIndex = call.args.pageIndex;
    const scale = call.args.scale;
    if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) throw new DesktopEngineCallError("engine_input_missing");
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) throw new DesktopEngineCallError("engine_input_missing");
    const password = typeof call.args.password === "string" ? call.args.password : undefined;
    const rendered = await renderPdfPagePng(bytes, pageIndex, scale, password);
    // Out of range or an unallocatable bitmap is a refusal, not a blank page.
    if (!rendered) throw new DesktopEngineCallError("engine_render_unavailable");
    return { ok: true, operation: "render", pngBase64: rendered.pngBase64, width: rendered.width, height: rendered.height };
  }
  throw new DesktopEngineCallError("engine_operation_unsupported");
}

/** Answer one validated `desktop:engine-call`. The operation is dispatched
 * first so an unbound one is refused by name rather than as a missing payload.
 * A password wall is returned as typed data so it survives the IPC hop; every
 * other failure throws, and a partial edit never returns bytes. */
export async function handleDesktopEngineCall(call: DesktopEngineCall): Promise<DesktopEngineCallResult> {
  try {
    return await dispatch(call);
  } catch (error) {
    if (error instanceof PdfPasswordError) return { ok: false, error: { kind: "password", status: error.status } };
    throw error;
  }
}
