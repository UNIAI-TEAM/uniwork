"use client";

import { createElement, lazy, Suspense, type ReactNode } from "react";
import { sha256Hex } from "@uniwork/office-contracts";
import { applyPdfOpsInBrowser, readPdfFormFields, readPdfNotes } from "@uniwork/office-engine/browser";
import { isOfficeTooLarge, type EditorHandle, type OfficeCapabilityEntry, type OfficeHost, type StableSnapshot } from "@uniwork/core/office";
import {
  bridgePdfOperations,
  createPdfEditorLoader,
  quadsForRange,
  toNoteThreads,
  type PdfCapability,
  type PdfEditOperation,
  type PdfEditorHandle,
  type PdfNoteThread,
  type PdfOpenOutcome,
  type PdfOpenPort,
  type PdfSnapshot,
} from "@uniwork/views/office/pdf";
import type { OfficeEditorComponent } from "@uniwork/views/office";
import { createOfficeEditorSession, type BrowserOfficeDraftOptions } from "./editor-host-core";
import { createPdfRenderSession, type PdfRenderSession } from "./pdf-render";
import { createPdfSaveTransport, type PdfDocumentsTransport } from "./pdf-save-transport";

export interface PdfFormatAdapterOptions extends BrowserOfficeDraftOptions<PdfSnapshot> {
  documents: PdfDocumentsTransport;
  capability: OfficeCapabilityEntry;
  title: string;
  onRecoverSnapshot?: (snapshot: StableSnapshot<PdfSnapshot>) => Promise<void> | void;
  /** Test seams; production uses the browser engine and the pdfium render session. */
  createRenderSession?: typeof createPdfRenderSession;
  applyOps?: typeof applyPdfOpsInBrowser;
  readFormFields?: typeof readPdfFormFields;
  readNotes?: typeof readPdfNotes;
  /** Test seam: the undo/redo byte budget; production uses UNDO_BYTE_BUDGET. */
  undoByteBudget?: number;
}

type SearchHits = Awaited<ReturnType<NonNullable<PdfEditorHandle["searchText"]>>>;
type FailureClass = "password_required" | "wrong_password" | "too_large" | "engine_error";

interface PdfEditorSurface extends PdfEditorHandle<PdfSnapshot> {
  /** The web lane opens with an optional password (C3) and threads the
   * caller's AbortSignal so a superseded open stops early; the base handle's
   * `open()` takes neither, so the surface widens it here. */
  open(signal?: AbortSignal, password?: string): Promise<void>;
  openOutcome(): PdfOpenOutcome | null;
  serializeSnapshot(snapshot: StableSnapshot<PdfSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
  /** Final teardown, called when the host session is disposed. dispose() alone stays reopenable. */
  terminate(): void;
  openFailureClass(): FailureClass;
}

/** The undo/redo stacks keep the newest byte snapshots until this budget is spent. */
const UNDO_BYTE_BUDGET = 256 * 1024 * 1024;

/** Push a snapshot and drop the oldest entries past the budget, always keeping
    at least the newest one. */
function pushBounded(stack: Uint8Array[], bytes: Uint8Array, budget: number): void {
  stack.push(bytes);
  let total = stack.reduce((sum, entry) => sum + entry.byteLength, 0);
  while (total > budget && stack.length > 1) {
    const dropped = stack.shift();
    if (dropped) total -= dropped.byteLength;
  }
}

function failureClassOf(error: unknown): FailureClass {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "password_required" || code === "wrong_password") return code;
  return isOfficeTooLarge(error as { code?: string; kind?: string; failureClass?: string }) ? "too_large" : "engine_error";
}

/**
 * The web PDF handle. Bytes are read once and cached; every edit runs the
 * browser engine over the current bytes, swaps the render session's document and
 * bumps the generation. `dispose()` only releases the render session so React
 * StrictMode can dispose and re-open; `terminate()` is the final teardown.
 */
function createPdfEditorSurface(options: {
  documentId: string;
  documents: PdfDocumentsTransport;
  createRenderSession: typeof createPdfRenderSession;
  applyOps: typeof applyPdfOpsInBrowser;
  readFormFields: typeof readPdfFormFields;
  readNotes: typeof readPdfNotes;
  undoByteBudget: number;
}): PdfEditorSurface {
  let original: Uint8Array | null = null;
  let current: Uint8Array | null = null;
  let undoStack: Uint8Array[] = [];
  let redoStack: Uint8Array[] = [];
  let render: PdfRenderSession | null = null;
  let snapshot: PdfSnapshot | null = null;
  let outcome: PdfOpenOutcome | null = null;
  let generation = 0;
  let epoch = 0;
  let opening: Promise<void> | null = null;
  let terminated = false;
  let lastFailure: FailureClass = "engine_error";
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const requireSession = (): PdfRenderSession => {
    if (!render || !current) throw new Error("pdf_editor_not_open");
    return render;
  };
  const refreshSnapshot = () => {
    const pages = requireSession().pages();
    snapshot = { pages: pages.map((page) => ({ pageNumber: page.pageNumber, rotation: 0 })), pageCount: pages.length };
  };
  const notify = () => { for (const listener of [...listeners]) listener(); };
  /** Serialises submit/undo/redo so byte stacks never interleave. */
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  const swapDocument = async (bytes: Uint8Array) => {
    await requireSession().replaceBytes(bytes);
    current = bytes;
    generation += 1;
    refreshSnapshot();
    notify();
  };

  const load = async (signal?: AbortSignal, password?: string) => {
    if (terminated) throw new Error("pdf_editor_disposed");
    // A password retry must re-run the open: a cached attempt already failed
    // with password_required/wrong_password, so reuse would loop the prompt.
    if (password !== undefined) opening = null;
    opening ??= (async () => {
      const myEpoch = epoch;
      try {
        if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
        const bytes = original ?? await options.documents.read();
        if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
        const session = await options.createRenderSession(bytes, password === undefined ? undefined : { password });
        if (signal?.aborted) { session.dispose(); throw new DOMException("Open cancelled", "AbortError"); }
        if (myEpoch !== epoch || terminated) { session.dispose(); throw new Error("pdf_editor_disposed"); }
        original = bytes;
        current = bytes;
        render = session;
        undoStack = [];
        redoStack = [];
        refreshSnapshot();
        outcome = { outcome: "opened", document_id: options.documentId, document_model_ref: `web:pdf:${options.documentId}`, warnings: [] };
      } catch (error) {
        lastFailure = failureClassOf(error);
        throw error;
      }
    })().catch((error: unknown) => { opening = null; throw error; });
    await opening;
  };

  const submitEngineOperations: NonNullable<PdfEditorHandle["submitEngineOperations"]> = (operations) => enqueue(async () => {
    const bytes = current;
    if (!bytes) throw new Error("pdf_editor_not_open");
    const result = await options.applyOps(bytes, operations);
    await swapDocument(result.bytes);
    pushBounded(undoStack, bytes, options.undoByteBudget);
    redoStack = [];
    return { skipped: result.skipped };
  });

  const step = (from: () => Uint8Array[], to: () => Uint8Array[]) => {
    void enqueue(async () => {
      const source = from();
      const target = source[source.length - 1];
      const bytes = current;
      if (!target || !bytes) return;
      await swapDocument(target);
      source.pop();
      pushBounded(to(), bytes, options.undoByteBudget);
    }).catch(() => undefined);
  };

  const renderer: NonNullable<PdfEditorHandle["renderer"]> = {
    renderPage: (request) => {
      if (!render) return Promise.reject(new Error("pdf_editor_not_open"));
      return render.renderPage(request);
    },
  };

  return {
    format: "pdf",
    open: (signal?: AbortSignal, password?: string) => load(signal, password),
    openOutcome: () => outcome,
    openFailureClass: () => lastFailure,
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      if (!snapshot || !current) throw new Error("pdf_snapshot_unavailable");
      const value: PdfSnapshot = { pages: snapshot.pages.map((page) => ({ ...page })), pageCount: snapshot.pageCount };
      const fingerprint = await sha256Hex(new TextEncoder().encode(`${options.documentId}:${generation}:${value.pageCount}`));
      return { generation, fingerprint, value, checksumSha256: await sha256Hex(current), sizeBytes: current.byteLength };
    },
    async serializeSnapshot() {
      if (!current) throw new Error("pdf_editor_not_open");
      return { bytes: current.slice(), checksum: await sha256Hex(current) };
    },
    getPdfSnapshot: () => (snapshot ? { pages: snapshot.pages.map((page) => ({ ...page })), pageCount: snapshot.pageCount } : null),
    renderer,
    getCanvasPages: () => (render ? render.pages().map((page) => ({ ...page })) : []),
    submitEngineOperations,
    async edit(operations: readonly PdfEditOperation[]) {
      const pageCount = snapshot?.pageCount ?? 0;
      const engineOps = await bridgePdfOperations(operations, { pageOrder: Array.from({ length: pageCount }, (_, index) => index) });
      await submitEngineOperations(engineOps);
    },
    async readFormFields() {
      if (!current) return [];
      return options.readFormFields(current);
    },
    async readSavedNotes(): Promise<readonly PdfNoteThread[]> {
      const bytes = current;
      if (!bytes) return [];
      const read = await options.readNotes(bytes);
      return toNoteThreads(read);
    },
    async searchText(query): Promise<SearchHits> {
      const needle = query.trim().toLowerCase();
      const session = render;
      if (!needle || !session) return [];
      const hits: SearchHits[number][] = [];
      for (const page of session.pages()) {
        const text = session.pageText(page.pageNumber);
        const haystack = text.toLowerCase();
        // Page geometry is read once per page, lazily: a host that cannot read it
        // simply leaves the hit without quads, so it paints nothing.
        let charBoxes: readonly { x: number; y: number; width: number; height: number }[] | null = null;
        for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
          const end = at + needle.length;
          if (charBoxes === null) {
            try {
              charBoxes = session.pageCharBoxes(page.pageNumber);
            } catch {
              charBoxes = [];
            }
          }
          const hit: SearchHits[number] = { id: `${page.pageNumber}:${at}`, page: page.pageNumber, start: at, end, text: text.slice(at, end) };
          // pageCharBoxes are already in the page's DISPLAY space (the /Rotate
          // transform is applied), so flip with the display height the renderer
          // reports - the same height the canvas paints the raster at.
          const quads = quadsForRange(charBoxes, at, end, page.height);
          if (quads.length > 0) hit.quads = quads;
          hits.push(hit);
        }
      }
      return hits;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    undo: () => step(() => undoStack, () => redoStack),
    redo: () => step(() => redoStack, () => undoStack),
    dispose() {
      epoch += 1;
      opening = null;
      render?.dispose();
      render = null;
      current = null;
      snapshot = null;
      outcome = null;
      generation = 0;
      undoStack = [];
      redoStack = [];
    },
    terminate() { terminated = true; void this.dispose(); },
  };
}

export function createPdfFormatAdapter(options: PdfFormatAdapterOptions) {
  const editor = createPdfEditorSurface({
    documentId: options.identity.documentId,
    documents: options.documents,
    createRenderSession: options.createRenderSession ?? createPdfRenderSession,
    applyOps: options.applyOps ?? applyPdfOpsInBrowser,
    readFormFields: options.readFormFields ?? readPdfFormFields,
    readNotes: options.readNotes ?? readPdfNotes,
    undoByteBudget: options.undoByteBudget ?? UNDO_BYTE_BUDGET,
  });
  const transport = createPdfSaveTransport({
    documentId: options.identity.documentId,
    documents: options.documents,
    serialize: (snapshot) => editor.serializeSnapshot(snapshot),
  });
  const session = createOfficeEditorSession({ ...options, editor, transport });
  session.coordinator.setCapability(options.capability);
  const open: PdfOpenPort = {
    async open(signal?: AbortSignal, password?: string): Promise<PdfOpenOutcome> {
      if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
      try {
        await editor.open(signal, password);
        if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
        const result = editor.openOutcome();
        if (!result) throw new Error("pdf_open_outcome_missing");
        return result;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return {
          outcome: "failed", document_id: options.identity.documentId, format: "pdf", failure_class: editor.openFailureClass(),
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
  const originalDispose = session.dispose;
  let disposal: Promise<void> | null = null;
  session.dispose = () => disposal ??= (async () => {
    await session.coordinator.cancel();
    await originalDispose();
    editor.terminate();
  })();
  const loadPdfEditor = createPdfEditorLoader({
    documentKey: options.identity.documentId,
    open,
    coordinator: session.coordinator,
    capability: options.capability as PdfCapability,
    title: options.title,
  });
  const PdfSlot = lazy(async () => {
    const loaded = await loadPdfEditor("pdf");
    return ("default" in loaded ? loaded : { default: loaded }) as { default: OfficeEditorComponent };
  });
  // The PDF slot renderer only consumes the editor handle, so the slot gets a
  // typed placeholder instead of the shared host adapter.
  const slotHost = {} as OfficeHost;
  const editorView: ReactNode = createElement(
    Suspense,
    { fallback: null },
    createElement(PdfSlot, { format: "pdf", host: slotHost, editorHandle: editor as EditorHandle }),
  );
  return {
    session, editor, open, capability: options.capability, editorView,
    onRecoverSnapshot: options.onRecoverSnapshot,
  };
}
