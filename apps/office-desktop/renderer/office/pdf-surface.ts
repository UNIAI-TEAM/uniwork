import { bridgePdfOperations, type PdfCanvasPage, type PdfEditOperation, type PdfEditorHandle, type PdfOpenOutcome, type PdfPageRenderService, type PdfRenderPageRequest, type PdfRenderResult, type PdfSelectionPort, type PdfSnapshot } from "@uniwork/views/office/pdf";
import type { DesktopDocumentFormat } from "../../shared/document-formats";
import type { DesktopIpcRequest } from "../../shared/ipc";
import type { DesktopSurfaceSettings } from "./surface";

/** One page's size in PDF points, in page order; zero when pdfium could not
 * read it. */
interface PageSize {
  width: number;
  height: number;
}

type EngineResponse = {
  ok: boolean;
  probe?: { pageCount: number };
  /** Real per-page sizes from the open probe (U2). */
  pageSizes?: PageSize[];
  /** Rendered page pixels, base64 PNG (render). */
  pngBase64?: string;
  width?: number;
  height?: number;
  dataBase64?: string;
  /** Skips the edit lane reported (a note page out of range, a form value the
   * font cannot encode); the panel providers turn these into their own message. */
  warnings?: readonly { code: string; detail?: string }[];
  error?: { kind?: string; status?: string };
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** A4 portrait is the fallback box when the probe could not report a size, so
 * the canvas never collapses a page to a zero-sized rectangle. */
const FALLBACK_PAGE_SIZE: PageSize = { width: 595.28, height: 841.89 };

function pageSizeAt(sizes: readonly PageSize[], index: number): PageSize {
  const size = sizes[index];
  if (size && size.width > 0 && size.height > 0) return size;
  return FALLBACK_PAGE_SIZE;
}

function abortError(): DOMException {
  return new DOMException("The pdf render was aborted", "AbortError");
}

/** The op name each engine warning detail begins with; the detail prefixes the
 * kind (`note page=1: …`) or, for a form value, the field (`form field "x": …`). */
const SKIP_OP_BY_PREFIX: Readonly<Record<string, string>> = {
  text: "putTextEdit",
  insert: "addTextInsert",
  image: "addImageEdit",
  annot: "deleteAnnots",
  markup: "addMarkup",
  drawing: "addDrawing",
  stamp: "addStamp",
  note: "addNote",
  "note-edit": "editSavedNote",
  "note-resolve": "resolveNote",
};

/** Turn the edit lane's skip warnings into the view's `{op, reason}` shape so a
 * refused note or form value is reported instead of silently claimed as applied. */
function skippedFromWarnings(warnings: readonly { code: string; detail?: string }[] | undefined): { op: string; reason: string }[] {
  const skipped: { op: string; reason: string }[] = [];
  for (const warning of warnings ?? []) {
    if (warning.code !== "edit_skipped" || typeof warning.detail !== "string") continue;
    const detail = warning.detail;
    if (detail.startsWith('form field "')) {
      skipped.push({ op: "setFormValue", reason: detail });
      continue;
    }
    const prefix = detail.split(" ")[0] ?? "";
    skipped.push({ op: SKIP_OP_BY_PREFIX[prefix] ?? prefix, reason: detail });
  }
  return skipped;
}

function passwordFailureClass(error: EngineResponse["error"]): "password_required" | "wrong_password" | null {
  if (error?.kind !== "password") return null;
  return error.status === "wrong" ? "wrong_password" : "password_required";
}

export function createDesktopPdfSurface(settings: DesktopSurfaceSettings): PdfEditorHandle<Uint8Array> & {
  format: DesktopDocumentFormat;
  open(signal?: AbortSignal, password?: string): Promise<void>;
  openOutcome(): PdfOpenOutcome | null;
  subscribeDirty(listener: (generation: number) => void): () => void;
  getPdfSnapshot(): PdfSnapshot | null;
  selection: PdfSelectionPort;
  edit(operations: readonly unknown[]): Promise<void>;
  submitEngineOperations(operations: readonly unknown[]): Promise<{ skipped: readonly { op: string; reason: string }[] }>;
} {
  let bytes: Uint8Array = Uint8Array.from([]);
  let generation = settings.generation;
  let snapshot: PdfSnapshot | null = null;
  let outcome: PdfOpenOutcome | null = null;
  let pageSizes: readonly PageSize[] = [];
  let pageCount = 0;
  let password: string | undefined;
  let disposed = false;
  const listeners = new Set<(generation: number) => void>();
  let selected: Parameters<NonNullable<PdfSelectionPort["setSelection"]>>[0] = null;
  const selection: PdfSelectionPort = {
    getSelection: () => selected,
    setSelection: (next) => { selected = next ?? null; },
    subscribe: (listener) => { listener(selected); return () => undefined; },
  };
  const callEngine = async (operation: "open" | "edit" | "render", args: Record<string, unknown>): Promise<EngineResponse> => {
    const payload: DesktopIpcRequest<"desktop:engine-call"> = { sessionGeneration: settings.sessionGeneration, operation, handle: settings.documentId, args };
    return await settings.bridge.call("desktop:engine-call", payload) as EngineResponse;
  };

  /** Rendered pages, keyed by page@scale@generation. An edit bumps the
   * generation, so a stale key never serves the pre-edit pixels; a failed
   * render is dropped from the cache instead of poisoning it. */
  let cache = new Map<string, Promise<PdfRenderResult>>();
  const clearCache = (): void => { cache = new Map(); };

  /** The stable renderer identity React holds. Its methods close over the live
   * bytes/generation, so the object never has to be recreated. */
  const renderer: PdfPageRenderService = {
    async renderPage(request: PdfRenderPageRequest): Promise<PdfRenderResult> {
      if (disposed) throw new Error("pdf_surface_disposed");
      if (request.signal?.aborted) throw abortError();
      const index = request.pageNumber - 1;
      if (!Number.isInteger(index) || index < 0 || index >= pageCount) throw new Error("pdf_render_page_out_of_range");
      const key = `${request.pageNumber}:${request.scale}:${generation}`;
      let pending = cache.get(key);
      if (!pending) {
        const args: Record<string, unknown> = { dataBase64: encodeBase64(bytes), pageIndex: index, scale: request.scale };
        if (password !== undefined) args.password = password;
        pending = (async () => {
          const result = await callEngine("render", args);
          if (!result.ok || !result.pngBase64) throw new Error("pdf_render_failed");
          return { src: `data:image/png;base64,${result.pngBase64}`, width: result.width ?? 0, height: result.height ?? 0 };
        })();
        cache.set(key, pending);
        pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
      }
      const result = await pending;
      if (request.signal?.aborted) throw abortError();
      return result;
    },
  };

  const canvasPages = (): readonly PdfCanvasPage[] => Array.from({ length: pageCount }, (_, index) => {
    const size = pageSizeAt(pageSizes, index);
    return { pageNumber: index + 1, width: size.width, height: size.height, rotation: 0, boxes: [] };
  });

  const applyGeometry = (probe: { pageCount: number }, sizes: readonly PageSize[]): void => {
    pageCount = probe.pageCount;
    pageSizes = sizes;
    snapshot = { pages: canvasPages().map((page) => ({ pageNumber: page.pageNumber, rotation: page.rotation ?? 0 })), pageCount };
  };

  /** A page-count-changing edit (delete, reorder, insert) must refresh the page
   * boxes, or the canvas draws a phantom page the engine then refuses to render.
   * A failed re-probe keeps the previous geometry and never fails the edit. */
  const refreshGeometry = async (): Promise<void> => {
    const args: Record<string, unknown> = { dataBase64: encodeBase64(bytes) };
    if (password !== undefined) args.password = password;
    try {
      const result = await callEngine("open", args);
      if (result.ok && result.probe) applyGeometry(result.probe, result.pageSizes ?? []);
    } catch {
      // Keep the pre-edit geometry; the edit itself already succeeded.
    }
  };

  /** Apply one batch of engine envelopes, swap the bytes, bump the generation and
   * report the skips. Shared by the snake_case `edit` path and the camelCase
   * panel path so both keep one dirty/refresh discipline. */
  const applyEngineEdits = async (edits: readonly unknown[]): Promise<{ skipped: { op: string; reason: string }[] }> => {
    if (settings.readOnly) throw new Error("pdf_readonly");
    const result = await callEngine("edit", { dataBase64: encodeBase64(bytes), edits: [...edits] });
    if (!result.ok || !result.dataBase64) throw new Error("pdf_edit_failed");
    bytes = Uint8Array.from(decodeBase64(result.dataBase64));
    await refreshGeometry();
    generation += 1;
    // The edited bytes paint differently: drop every cached page and let the
    // canvas re-request it through the new generation key.
    clearCache();
    for (const listener of listeners) listener(generation);
    return { skipped: skippedFromWarnings(result.warnings) };
  };

  const surface = {
    format: "pdf" as const,
    async open(_signal?: AbortSignal, nextPassword?: string) {
      if (disposed) throw new Error("pdf_surface_disposed");
      bytes = Uint8Array.from(await settings.readBytes());
      const args: Record<string, unknown> = { dataBase64: encodeBase64(bytes) };
      if (nextPassword !== undefined) args.password = nextPassword;
      const result = await callEngine("open", args);
      if (result.ok && result.probe) {
        password = nextPassword;
        clearCache();
        applyGeometry(result.probe, result.pageSizes ?? []);
        outcome = { outcome: "opened", document_id: settings.documentId, document_model_ref: `desktop:pdf:${settings.documentId}`, warnings: [] };
        return;
      }
      const failureClass = passwordFailureClass(result.error);
      if (failureClass) {
        outcome = { outcome: "failed", document_id: settings.documentId, format: "pdf", failure_class: failureClass };
        return;
      }
      throw new Error("pdf_open_failed");
    },
    openOutcome: () => outcome,
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      const fingerprint = `pdf:${bytes.byteLength}:${generation}`;
      return { generation, fingerprint, value: bytes.slice(), sizeBytes: bytes.byteLength };
    },
    async edit(operations: readonly unknown[]) {
      const edits = await bridgePdfOperations(operations as readonly PdfEditOperation[]);
      await applyEngineEdits(edits);
    },
    // The panel providers (notes, stamps, forms) hand over already-bridged
    // camelCase envelopes, so they skip the snake_case bridge and go straight to
    // the engine. Returning the skips lets the view report a refused write.
    submitEngineOperations: (operations: readonly unknown[]) => applyEngineEdits(operations),
    getPdfSnapshot: () => snapshot,
    renderer,
    getCanvasPages: canvasPages,
    selection,
    subscribeDirty: (listener: (next: number) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    dispose: () => { disposed = true; listeners.clear(); clearCache(); bytes = Uint8Array.from([]); snapshot = null; pageSizes = []; pageCount = 0; password = undefined; },
  };
  return surface;
}
