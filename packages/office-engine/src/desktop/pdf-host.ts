// @uniwork/office-engine/desktop — the PDF host lane. The desktop main process
// owns pdfium/pdf-lib (Node only); the renderer reaches it through the typed
// `desktop:engine-call` payload and never imports this module (ADR 0021). The
// entries below are the whole lane: `open` probes the bytes into a view-safe
// page summary plus per-page sizes, `edit` applies one batch and returns the
// verified output bytes, `render` rasterises one page to a PNG, and `text` reads
// a page range's text layer (plus per-character display-space boxes on request) so the renderer can run
// find, and `close` frees a retained document. An `open` asked to `retain` keeps
// the bytes (and the password that opened them) in this process and answers an
// opaque `pdfHandle`, so `render` and `text` name the document instead of
// shipping it over IPC for every page. Paths and file handles stay on the host side.
import { applyPdfEditBytes, PdfPasswordError, probePdf, type PdfEditOutcome, type PdfPasswordStatus, type PdfProbe } from "../pdf/index";
import { randomBytes } from "node:crypto";
import { readPdfPageSizes, readPdfTextRange, releaseLoadedPdf, renderPdfPagePng, type DesktopPdfTextPage } from "./pdf-render.ts";

/** Operations the IPC schema lets a caller name. `open`, `edit`, `render`,
 * `text` and `close` are bound; the rest answer `engine_operation_unsupported` before any
 * payload is read. */
export type DesktopEngineOperation = "open" | "edit" | "render" | "text" | "close" | "capability" | "serialize" | "cancel";

export interface DesktopEngineCall {
  readonly operation: DesktopEngineOperation;
  /** Opaque host handle; never a filesystem path. */
  readonly handle: string;
  /** The renderer session the call came from. A retained document belongs to
   * this session plus `handle`, so no other document or session can use it. */
  readonly sessionGeneration?: string;
  readonly args: {
    /** `open`: keep the document in this process and answer a `pdfHandle`. */
    readonly retain?: unknown;
    /** `render` / `text` / `close`: the retained document, in place of
     * `dataBase64`. A retained `open` naming the caller's live handle replaces
     * it and reuses the password that handle was opened with. */
    readonly pdfHandle?: unknown;
    /** The surface instance the call came from: two surfaces of one document
     * (draft recovery builds the new one before disposing the old) each keep
     * their own retained document. */
    readonly surface?: unknown;
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
  /** Present when the open asked to `retain` the document. */
  readonly pdfHandle?: string;
}

export interface DesktopEngineCloseResult {
  readonly ok: true;
  readonly operation: "close";
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

/** The retained document a `pdfHandle` names is gone (closed, replaced by a
 * newer open of the same document, evicted, or never this caller's). Typed
 * data, so the renderer can re-open once instead of reading a flattened error. */
export interface DesktopEngineHandleRefusal {
  readonly ok: false;
  readonly error: { readonly kind: "handle"; readonly status: "unknown" };
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

export type DesktopEngineCallResult = DesktopEngineOpenResult | DesktopEngineEditResult | DesktopEngineRenderResult | DesktopEngineTextResult | DesktopEngineCloseResult | DesktopEnginePasswordRefusal | DesktopEngineHandleRefusal;

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

/** One retained document. The password lives only here, in main-process
 * memory: it is never logged or answered, and leaves with the entry. */
interface RetainedPdf {
  readonly owner: string;
  bytes: Uint8Array;
  password: string | undefined;
}

interface RetainedPdfBudget {
  readonly maxDocuments: number;
  readonly maxBytes: number;
}

/** Open documents across every window: a handful of tabs, and a total that a
 * desktop main process can hold beside the pdfium heap. */
const DEFAULT_RETAINED_BUDGET: RetainedPdfBudget = { maxDocuments: 8, maxBytes: 512 * 1024 * 1024 };
let retainedBudget = DEFAULT_RETAINED_BUDGET;
/** Retained documents by handle; Map order is the LRU order (oldest first). */
const retained = new Map<string, RetainedPdf>();
/** The one live handle per owner (renderer load + session + document + surface). */
const liveHandleByOwner = new Map<string, string>();
let retainedBytes = 0;
/** The renderer load every owner belongs to. The host bumps it when its
 * renderer reloads, navigates, crashes or goes away (releaseRetainedPdfs), so
 * the previous load's documents are freed and none of its handles or late
 * opens match an owner again. */
let rendererLoad = 0;

class StaleHandleError extends Error {}

const MAX_SURFACE_ID_LENGTH = 128;

function ownerOf(call: DesktopEngineCall): string {
  const surface = call.args.surface ?? "";
  if (typeof surface !== "string" || surface.length > MAX_SURFACE_ID_LENGTH) throw new DesktopEngineCallError("engine_input_missing");
  return `${rendererLoad}\u0000${call.sessionGeneration ?? ""}\u0000${call.handle}\u0000${surface}`;
}

function release(pdfHandle: string): void {
  const entry = retained.get(pdfHandle);
  if (!entry) return;
  retained.delete(pdfHandle);
  if (liveHandleByOwner.get(entry.owner) === pdfHandle) liveHandleByOwner.delete(entry.owner);
  retainedBytes -= entry.bytes.byteLength;
  entry.bytes = new Uint8Array(0);
  entry.password = undefined;
  void releaseLoadedPdf(pdfHandle);
}

/** Free every retained document and start a new renderer load. The desktop
 * host calls this when its window's renderer reloads, navigates, crashes or is
 * destroyed: nothing the previous load opened survives it, and an open still in
 * flight from that load is not retained when it lands. */
export function releaseRetainedPdfs(): void {
  rendererLoad += 1;
  for (const pdfHandle of [...retained.keys()]) release(pdfHandle);
}

/** Drop the least recently used documents past the budget, always keeping the
 * newest one: a document bigger than the byte budget still prints. */
function enforceBudget(): void {
  while (retained.size > 1 && (retained.size > retainedBudget.maxDocuments || retainedBytes > retainedBudget.maxBytes)) {
    const oldest = retained.keys().next().value;
    if (oldest === undefined) return;
    release(oldest);
  }
}

/** Keep `bytes` for `owner`, replacing the owner's previous document (a
 * document change makes the old bytes useless), and answer the new handle. */
function retain(owner: string, bytes: Uint8Array, password: string | undefined): string {
  const previous = liveHandleByOwner.get(owner);
  if (previous) release(previous);
  const pdfHandle = `pdf_${randomBytes(16).toString("hex")}`;
  retained.set(pdfHandle, { owner, bytes, password });
  liveHandleByOwner.set(owner, pdfHandle);
  retainedBytes += bytes.byteLength;
  enforceBudget();
  return pdfHandle;
}

/** The bytes and password a call reads: the retained document its `pdfHandle`
 * names (touched as most recently used), else the inline `dataBase64`. A handle
 * that is not a live one of this caller is stale, never another caller's. */
function documentOf(call: DesktopEngineCall): { bytes: Uint8Array; password: string | undefined; pdfHandle?: string } {
  const pdfHandle = call.args.pdfHandle;
  if (pdfHandle === undefined) {
    return { bytes: decode(call.args.dataBase64), password: typeof call.args.password === "string" ? call.args.password : undefined };
  }
  // A handle names the whole document: bytes beside it would be ambiguous.
  if (typeof pdfHandle !== "string" || call.args.dataBase64 !== undefined) throw new DesktopEngineCallError("engine_input_missing");
  const entry = retained.get(pdfHandle);
  if (!entry || entry.owner !== ownerOf(call)) throw new StaleHandleError();
  retained.delete(pdfHandle);
  retained.set(pdfHandle, entry);
  return { bytes: entry.bytes, password: entry.password, pdfHandle };
}

/** The password a retained `open` uses: its own, else the one of the caller's
 * live `pdfHandle` it replaces, so a re-probe after an edit never sends the
 * password again. */
function openPassword(call: DesktopEngineCall, owner: string): string | undefined {
  if (typeof call.args.password === "string") return call.args.password;
  const pdfHandle = call.args.pdfHandle;
  if (pdfHandle === undefined || call.args.retain !== true) return undefined;
  if (typeof pdfHandle !== "string") throw new DesktopEngineCallError("engine_input_missing");
  const entry = retained.get(pdfHandle);
  return entry?.owner === owner ? entry.password : undefined;
}

/** After a read by handle: a handle freed while its read was queued must not
 * leave its document loaded in pdfium. */
function afterRetainedRead(pdfHandle: string | undefined): void {
  if (pdfHandle !== undefined && !retained.has(pdfHandle)) void releaseLoadedPdf(pdfHandle);
}

/** Test seam: what the store holds, with no bytes or password in the answer. */
export function retainedPdfStatsForTests(): { documents: number; bytes: number; withPassword: number } {
  let withPassword = 0;
  for (const entry of retained.values()) if (entry.password !== undefined) withPassword += 1;
  return { documents: retained.size, bytes: retainedBytes, withPassword };
}

/** Test seam: swap the budget; the returned function restores the default. */
export function setRetainedPdfBudgetForTests(budget: RetainedPdfBudget): () => void {
  retainedBudget = budget;
  return () => { retainedBudget = DEFAULT_RETAINED_BUDGET; };
}

async function dispatch(call: DesktopEngineCall): Promise<DesktopEngineCallResult> {
  if (call.operation === "open") {
    const bytes = decode(call.args.dataBase64);
    // The owner is fixed before the first await: an open that a renderer
    // reload overtakes still belongs to the load that sent it.
    const owner = ownerOf(call);
    const password = openPassword(call, owner);
    // This turn needs the heap more than the page document kept loaded does.
    void releaseLoadedPdf();
    // The probe is the gate: an encrypted document without the right password
    // must answer the typed wall before any size read touches pdfium.
    const probe = await probePdf(bytes, password);
    const pageSizes = await readPdfPageSizes(bytes, password);
    if (call.args.retain !== true) return { ok: true, operation: "open", probe, pageSizes };
    // The renderer load that sent this open is gone: keep nothing for it.
    if (ownerOf(call) !== owner) throw new StaleHandleError();
    return { ok: true, operation: "open", probe, pageSizes, pdfHandle: retain(owner, bytes, password) };
  }
  if (call.operation === "close") {
    // A close names the document it frees: "whatever this owner holds" could
    // free the live document of a surface that replaced the caller.
    const pdfHandle = call.args.pdfHandle;
    if (typeof pdfHandle !== "string") throw new DesktopEngineCallError("engine_input_missing");
    // Only the owner closes; closing an unknown or already-freed handle is a no-op.
    if (retained.get(pdfHandle)?.owner === ownerOf(call)) release(pdfHandle);
    return { ok: true, operation: "close" };
  }
  if (call.operation === "edit") {
    const bytes = decode(call.args.dataBase64);
    void releaseLoadedPdf();
    if (!Array.isArray(call.args.edits)) throw new DesktopEngineCallError("engine_input_missing");
    const result = await applyPdfEditBytes(bytes, call.args.edits);
    return { ok: true, operation: "edit", dataBase64: Buffer.from(result.bytes).toString("base64"), warnings: result.warnings, report: result.report };
  }
  if (call.operation === "text") {
    const { bytes, password, pdfHandle } = documentOf(call);
    const pageIndex = call.args.pageIndex;
    if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) throw new DesktopEngineCallError("engine_input_missing");
    const pageLimit = call.args.pageLimit ?? 1;
    if (typeof pageLimit !== "number" || !Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_TEXT_PAGE_LIMIT) throw new DesktopEngineCallError("engine_input_missing");
    const result = await readPdfTextRange(bytes, pageIndex, {
      pageLimit,
      geometry: call.args.geometry === true,
      ...(password === undefined ? {} : { password }),
      ...(pdfHandle === undefined ? {} : { retainedKey: pdfHandle }),
    }).finally(() => afterRetainedRead(pdfHandle));
    if (!result) throw new DesktopEngineCallError("engine_text_unavailable");
    return { ok: true, operation: "text", pageCount: result.pageCount, pages: result.pages };
  }
  if (call.operation === "render") {
    const { bytes, password, pdfHandle } = documentOf(call);
    const pageIndex = call.args.pageIndex;
    const scale = call.args.scale;
    if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) throw new DesktopEngineCallError("engine_input_missing");
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) throw new DesktopEngineCallError("engine_input_missing");
    const rendered = await renderPdfPagePng(bytes, pageIndex, scale, password, pdfHandle).finally(() => afterRetainedRead(pdfHandle));
    // Out of range or an unallocatable bitmap is a refusal, not a blank page.
    if (!rendered) throw new DesktopEngineCallError("engine_render_unavailable");
    return { ok: true, operation: "render", pngBase64: rendered.pngBase64, width: rendered.width, height: rendered.height };
  }
  throw new DesktopEngineCallError("engine_operation_unsupported");
}

/** Answer one validated `desktop:engine-call`. The operation is dispatched
 * first so an unbound one is refused by name rather than as a missing payload.
 * A password wall and a stale `pdfHandle` are returned as typed data so they
 * survive the IPC hop; every
 * other failure throws, and a partial edit never returns bytes. */
export async function handleDesktopEngineCall(call: DesktopEngineCall): Promise<DesktopEngineCallResult> {
  try {
    return await dispatch(call);
  } catch (error) {
    if (error instanceof PdfPasswordError) return { ok: false, error: { kind: "password", status: error.status } };
    if (error instanceof StaleHandleError) return { ok: false, error: { kind: "handle", status: "unknown" } };
    throw error;
  }
}
