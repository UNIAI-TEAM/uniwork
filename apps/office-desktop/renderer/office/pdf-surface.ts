import { readPdfFormFields, readPdfNotes } from "@uniwork/office-engine/browser";
import { bridgePdfOperations, quadsForRange, toNoteThreads, type PdfCanvasPage, type PdfEditOperation, type PdfEditorHandle, type PdfOpenOutcome, type PdfPageRenderService, type PdfRenderPageRequest, type PdfRenderResult, type PdfSelectionPort, type PdfSnapshot } from "@uniwork/views/office/pdf";
import type { DesktopDocumentFormat } from "../../shared/document-formats";
import type { DesktopIpcRequest } from "../../shared/ipc";
import type { DesktopSurfaceSettings } from "./surface";
import { incomingBytes } from "./bytes";

/** One page's size in PDF points, in page order; zero when pdfium could not
 * read it. */
interface PageSize {
  width: number;
  height: number;
}

/** One page's text layer plus one display-space box per character, from the
 * desktop engine's text read. */
interface EngineTextPage {
  page: number;
  width: number;
  height: number;
  text: string;
  charBoxes: readonly { x: number; y: number; width: number; height: number }[];
}

/** The find-hit shape the shared surface consumes; quads are optional so a page
 * with no readable geometry still reports the match. */
type SearchHits = Awaited<ReturnType<NonNullable<PdfEditorHandle["searchText"]>>>;

type EngineResponse = {
  ok: boolean;
  probe?: { pageCount: number };
  /** Real per-page sizes from the open probe (U2). */
  pageSizes?: PageSize[];
  /** Rendered page pixels, base64 PNG (render). */
  pngBase64?: string;
  width?: number;
  height?: number;
  data?: Uint8Array;
  /** Text layers of the requested page range (text read); `charBoxes` is empty unless
   * the request asked for geometry. */
  pageCount?: number;
  pages?: readonly EngineTextPage[];
  /** Skips the edit lane reported (a note page out of range, a form value the
   * font cannot encode); the panel providers turn these into their own message. */
  warnings?: readonly { code: string; detail?: string }[];
  error?: { kind?: string; status?: string };
};

/** Pages one text-only read covers; the engine caps a range at 32. */
const TEXT_CHUNK_PAGES = 16;

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

/** The undo/redo stacks keep the newest byte snapshots until this budget is
 * spent; the web lane uses the same budget. */
const UNDO_BYTE_BUDGET = 256 * 1024 * 1024;

/** Push a snapshot and drop the oldest entries past the budget, always keeping
 * at least the newest one. */
function pushBounded(stack: Uint8Array[], entry: Uint8Array, budget: number): void {
  stack.push(entry);
  let total = stack.reduce((sum, item) => sum + item.byteLength, 0);
  while (total > budget && stack.length > 1) {
    const dropped = stack.shift();
    if (dropped) total -= dropped.byteLength;
  }
}

/** `undoByteBudget` is a test seam; production uses UNDO_BYTE_BUDGET. */
export function createDesktopPdfSurface(settings: DesktopSurfaceSettings, undoByteBudget = UNDO_BYTE_BUDGET): PdfEditorHandle<Uint8Array> & {
  format: DesktopDocumentFormat;
  open(signal?: AbortSignal, password?: string): Promise<void>;
  openOutcome(): PdfOpenOutcome | null;
  subscribeDirty(listener: (generation: number) => void): () => void;
  getPdfSnapshot(): PdfSnapshot | null;
  selection: PdfSelectionPort;
  edit(operations: readonly unknown[]): Promise<void>;
  submitEngineOperations(operations: readonly unknown[]): Promise<{ skipped: readonly { op: string; reason: string }[] }>;
  subscribe(listener: () => void): () => void;
  undo(): void;
  redo(): void;
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
  /** Byte-change listeners of the shared editor (edit, undo, redo): it refreshes
   * the canvas and re-marks dirty with the new generation (G-1). */
  const changeListeners = new Set<() => void>();
  /** Pre-edit bytes for undo, and the bytes an undo stepped away from for redo.
   * Open and dispose reset both; a new edit clears redo. */
  let undoStack: Uint8Array[] = [];
  let redoStack: Uint8Array[] = [];
  /** Serialises edits and undo/redo so the byte stacks never interleave. */
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  let selected: Parameters<NonNullable<PdfSelectionPort["setSelection"]>>[0] = null;
  const selection: PdfSelectionPort = {
    getSelection: () => selected,
    setSelection: (next) => { selected = next ?? null; },
    subscribe: (listener) => { listener(selected); return () => undefined; },
  };
  const callEngine = async (operation: "open" | "edit" | "render" | "text", args: Record<string, unknown>): Promise<EngineResponse> => {
    const payload: DesktopIpcRequest<"desktop:engine-call"> = { sessionGeneration: settings.sessionGeneration, operation, handle: settings.documentId, args };
    return await settings.bridge.call("desktop:engine-call", payload) as EngineResponse;
  };

  /** Rendered pages, keyed by page@scale@generation. An edit bumps the
   * generation, so a stale key never serves the pre-edit pixels; a failed
   * render is dropped from the cache instead of poisoning it. */
  let cache = new Map<string, Promise<PdfRenderResult>>();
  const clearCache = (): void => { cache = new Map(); };

  /** The engine's text reads within one generation: text-only chunks of
   * `TEXT_CHUNK_PAGES` pages keyed by chunk start, and one-page geometry reads
   * keyed by page index, only for pages with a hit. An edit, open or dispose
   * swaps both maps for fresh ones, so edited bytes never answer with pre-edit
   * text and a search still in flight can only write into the discarded maps. A
   * failed, refused or password-walled read is dropped from its map instead of
   * poisoning it. */
  type TextRead = { status: "ok"; pages: readonly EngineTextPage[] } | { status: "wall" } | { status: "failed" };
  interface TextCaches { text: Map<number, Promise<TextRead>>; geometry: Map<number, Promise<TextRead>> }
  const freshTextCaches = (): TextCaches => ({ text: new Map(), geometry: new Map() });
  let textCaches = freshTextCaches();
  const clearTextCache = (): void => { textCaches = freshTextCaches(); };
  const readText = (caches: TextCaches, start: number, geometry: boolean): Promise<TextRead> => {
    const map = geometry ? caches.geometry : caches.text;
    const cached = map.get(start);
    if (cached) return cached;
    const args: Record<string, unknown> = { data: bytes, pageIndex: start, pageLimit: geometry ? 1 : TEXT_CHUNK_PAGES, geometry };
    if (password !== undefined) args.password = password;
    const pending = (async (): Promise<TextRead> => {
      try {
        const result = await callEngine("text", args);
        if (result.ok && Array.isArray(result.pages)) return { status: "ok", pages: result.pages };
        return result.error?.kind === "password" ? { status: "wall" } : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    })();
    map.set(start, pending);
    // A refused or failed read must be retried by the next query, not cached.
    void pending.then((read) => { if (read.status !== "ok" && map.get(start) === pending) map.delete(start); });
    return pending;
  };

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
        const args: Record<string, unknown> = { data: bytes, pageIndex: index, scale: request.scale };
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
    const args: Record<string, unknown> = { data: bytes };
    if (password !== undefined) args.password = password;
    try {
      const result = await callEngine("open", args);
      if (result.ok && result.probe) applyGeometry(result.probe, result.pageSizes ?? []);
    } catch {
      // Keep the pre-edit geometry; the edit itself already succeeded.
    }
  };

  /** Make `next` the document: re-probe the page geometry, bump the generation,
   * drop every cached page and text read, and tell both listener sets. Edits,
   * undo and redo all swap through here. `commit` moves the history stacks
   * before the listeners run, so a listener reading canUndo/canRedo sees the
   * stacks of the new bytes. A surface disposed during the await keeps its
   * reset state: nothing is committed and false comes back. */
  const swapBytes = async (next: Uint8Array, commit: () => void): Promise<boolean> => {
    if (disposed) return false;
    bytes = next;
    await refreshGeometry();
    if (disposed) return false;
    generation += 1;
    commit();
    // The new bytes paint differently: drop every cached page and let the
    // canvas re-request it through the new generation key.
    clearCache();
    clearTextCache();
    for (const listener of listeners) listener(generation);
    for (const listener of [...changeListeners]) listener();
    return true;
  };

  /** Apply one batch of engine envelopes, swap the bytes, bump the generation and
   * report the skips. Shared by the snake_case `edit` path and the camelCase
   * panel path so both keep one dirty/refresh discipline. */
  const applyEngineEdits = (edits: readonly unknown[]): Promise<{ skipped: { op: string; reason: string }[] }> => enqueue(async () => {
    if (settings.readOnly) throw new Error("pdf_readonly");
    const before = bytes;
    const result = await callEngine("edit", { data: bytes, edits: [...edits] });
    if (!result.ok || !result.data) throw new Error("pdf_edit_failed");
    const applied = await swapBytes(incomingBytes(result.data), () => {
      pushBounded(undoStack, before, undoByteBudget);
      redoStack = [];
    });
    if (!applied) throw new Error("pdf_surface_disposed");
    return { skipped: skippedFromWarnings(result.warnings) };
  });

  /** One history step with the web lane's semantics: an empty stack is a
   * no-op; otherwise the stack's newest bytes become the document and the
   * current bytes move onto the other stack. */
  const step = (from: () => Uint8Array[], to: () => Uint8Array[]): void => {
    if (settings.readOnly) return;
    void enqueue(async () => {
      const source = from();
      const target = source[source.length - 1];
      if (!target || disposed) return;
      const current = bytes;
      await swapBytes(target, () => {
        source.pop();
        pushBounded(to(), current, undoByteBudget);
      });
    }).catch(() => undefined);
  };

  const surface = {
    format: "pdf" as const,
    async open(_signal?: AbortSignal, nextPassword?: string) {
      if (disposed) throw new Error("pdf_surface_disposed");
      bytes = Uint8Array.from(await settings.readBytes());
      const args: Record<string, unknown> = { data: bytes };
      if (nextPassword !== undefined) args.password = nextPassword;
      const result = await callEngine("open", args);
      if (result.ok && result.probe) {
        password = nextPassword;
        undoStack = [];
        redoStack = [];
        clearCache();
        clearTextCache();
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
    /** Search the engine's text layer and return per-line display-space quads so
     * the shared find overlay paints a hit (F-13). Like the web lane it walks the
     * pages in order, but in chunks of `TEXT_CHUNK_PAGES` pages and text only,
     * asking for character geometry just for pages with a hit (one page per
     * call). A page whose geometry is unreadable still reports the match without
     * quads; a password wall ends the walk at once. */
    async searchText(query: string): Promise<SearchHits> {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const caches = textCaches;
      const hits: SearchHits[number][] = [];
      for (let start = 0; start < pageCount; start += TEXT_CHUNK_PAGES) {
        // An edit, open or dispose mid-search made this walk stale.
        if (caches !== textCaches) break;
        const chunk = await readText(caches, start, false);
        if (chunk.status === "wall") break;
        if (chunk.status !== "ok") continue;
        for (const textPage of chunk.pages) {
          const haystack = textPage.text.toLowerCase();
          let at = haystack.indexOf(needle);
          if (at === -1) continue;
          if (caches !== textCaches) break;
          const geometry = await readText(caches, textPage.page - 1, true);
          if (caches !== textCaches) break;
          const geometryPage = geometry.status === "ok" ? geometry.pages[0] : undefined;
          for (; at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
            const end = at + needle.length;
            const hit: SearchHits[number] = { id: `${textPage.page}:${at}`, page: textPage.page, start: at, end, text: textPage.text.slice(at, end) };
            // The engine emits boxes already in the page's DISPLAY space, the same
            // space as the raster and the reported page size, so flip with the
            // display height the surface lays the page out with.
            if (geometryPage) {
              const quads = quadsForRange(geometryPage.charBoxes, at, end, geometryPage.height);
              if (quads.length > 0) hit.quads = quads;
            }
            hits.push(hit);
          }
        }
      }
      return hits;
    },
    /** Form fields of the current bytes, read with the browser-safe pdf-lib
     * reader (no IPC). As on the web lane, bytes the reader cannot parse (a
     * password-protected file the engine only reads with its password) reject,
     * so the shared panel leaves its loading state with its error message
     * instead of claiming the file has no fields (R-3). */
    async readFormFields() {
      if (bytes.byteLength === 0) return [];
      return await readPdfFormFields(bytes);
    },
    /** Saved note threads of the current bytes, same reader discipline as the web
     * lane: an unreadable file rejects and the notes panel shows its error. */
    async readSavedNotes() {
      if (bytes.byteLength === 0) return [];
      return toNoteThreads(await readPdfNotes(bytes));
    },
    getPdfSnapshot: () => snapshot,
    renderer,
    getCanvasPages: canvasPages,
    selection,
    subscribeDirty: (listener: (next: number) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribe: (listener: () => void) => { changeListeners.add(listener); return () => { changeListeners.delete(listener); }; },
    undo: () => step(() => undoStack, () => redoStack),
    redo: () => step(() => redoStack, () => undoStack),
    canUndo: () => !settings.readOnly && undoStack.length > 0,
    canRedo: () => !settings.readOnly && redoStack.length > 0,
    dispose: () => { disposed = true; listeners.clear(); changeListeners.clear(); undoStack = []; redoStack = []; clearCache(); clearTextCache(); bytes = Uint8Array.from([]); snapshot = null; pageSizes = []; pageCount = 0; password = undefined; },
  };
  return surface;
}
