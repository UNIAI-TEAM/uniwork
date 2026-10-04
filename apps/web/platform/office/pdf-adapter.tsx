"use client";

import { createElement, lazy, Suspense, type ReactNode } from "react";
import { sha256Hex } from "@uniwork/office-contracts";
import { applyPdfOpsInBrowser, readPdfFormFields, readPdfNotes, type BrowserPdfNoteRow } from "@uniwork/office-engine/browser";
import type { EditorHandle, OfficeCapabilityEntry, OfficeHost, StableSnapshot } from "@uniwork/core/office";
import {
  bridgePdfOperations,
  createPdfEditorLoader,
  type PdfCapability,
  type PdfEditOperation,
  type PdfEditorHandle,
  type PdfNoteRow,
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
}

type SearchHits = Awaited<ReturnType<NonNullable<PdfEditorHandle["searchText"]>>>;
type FailureClass = "password_required" | "wrong_password" | "engine_error";

interface PdfEditorSurface extends PdfEditorHandle<PdfSnapshot> {
  /** The web lane opens with an optional password (C3); the base handle's
   * `open()` takes none, so the surface widens it here. */
  open(password?: string): Promise<void>;
  openOutcome(): PdfOpenOutcome | null;
  serializeSnapshot(snapshot: StableSnapshot<PdfSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
  /** Final teardown, called when the host session is disposed. dispose() alone stays reopenable. */
  terminate(): void;
  openFailureClass(): FailureClass;
}

const UNDO_LIMIT = 20;

function failureClassOf(error: unknown): FailureClass {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "password_required" || code === "wrong_password" ? code : "engine_error";
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
        const bytes = original ?? await options.documents.read();
        if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
        const session = await options.createRenderSession(bytes, password === undefined ? undefined : { password });
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
    undoStack.push(bytes);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
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
      to().push(bytes);
    }).catch(() => undefined);
  };

  const renderer: NonNullable<PdfEditorHandle["renderer"]> = {
    renderPage: (request) => {
      if (!render) return Promise.reject(new Error("pdf_editor_not_open"));
      return render.renderPage(request);
    },
  };

  /** Map a browser row onto the views' shape. A row the reader skipped cannot
      be acted on, so it is marked unbound; a reply is unbound only when the
      reader skipped it, never because its root was. */
  const toNoteRow = (row: BrowserPdfNoteRow, unbound: ReadonlySet<string>): PdfNoteRow => {
    const mapped: PdfNoteRow = {
      id: row.id,
      page: row.page,
      pageIndex: row.pageIndex,
      objNum: row.objNum,
      rect: row.rect,
      contents: row.contents,
      binding: unbound.has(row.id) ? "unbound" : "bound",
    };
    if (row.author !== undefined) mapped.author = row.author;
    if (row.resolved !== undefined) mapped.resolved = row.resolved;
    return mapped;
  };

  return {
    format: "pdf",
    open: (password?: string) => load(undefined, password),
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
      const unbound = new Set(read.skipped.map((skip) => `${skip.pageIndex}:${skip.objNum}`));
      return read.threads.map((thread) => ({
        id: thread.id,
        root: toNoteRow(thread.root, unbound),
        replies: thread.replies.map((reply) => toNoteRow(reply, unbound)),
      }));
    },
    async searchText(query): Promise<SearchHits> {
      const needle = query.trim().toLowerCase();
      const session = render;
      if (!needle || !session) return [];
      const hits: { id: string; page: number; start: number; end: number; text: string }[] = [];
      for (const { pageNumber } of session.pages()) {
        const text = session.pageText(pageNumber);
        const haystack = text.toLowerCase();
        for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
          hits.push({ id: `${pageNumber}:${at}`, page: pageNumber, start: at, end: at + needle.length, text: text.slice(at, at + needle.length) });
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
        await editor.open(password);
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
