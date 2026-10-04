"use client";

import { createElement, lazy, Suspense, type ReactNode } from "react";
import { sha256Hex } from "@uniwork/office-contracts";
import type { EditorHandle, OfficeCapabilityEntry, OfficeHost, StableSnapshot } from "@uniwork/core/office";
import {
  createPdfEditorLoader,
  type PdfCapability,
  type PdfEditorHandle,
  type PdfOpenOutcome,
  type PdfOpenPort,
  type PdfSnapshot,
} from "@uniwork/views/office/pdf";
import type { OfficeEditorComponent } from "@uniwork/views/office";
import { createOfficeEditorSession, type BrowserOfficeDraftOptions } from "./editor-host-core";
import { createPdfSaveTransport, type PdfDocumentsTransport } from "./pdf-save-transport";

export interface PdfFormatAdapterOptions extends BrowserOfficeDraftOptions<PdfSnapshot> {
  documents: PdfDocumentsTransport;
  capability: OfficeCapabilityEntry;
  title: string;
  onRecoverSnapshot?: (snapshot: StableSnapshot<PdfSnapshot>) => Promise<void> | void;
}

interface PdfEditorSurface extends PdfEditorHandle<PdfSnapshot> {
  openOutcome(): PdfOpenOutcome | null;
  serializeSnapshot(snapshot: StableSnapshot<PdfSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
}

/** Count pages from the raw bytes without decoding the document. The web T1
 * host only needs the page list; the real engine binding lands with the edit
 * lane, so a missing match falls back to a single page rather than failing. */
function countPdfPages(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page(?![s])/g);
  return Math.max(1, matches?.length ?? 1);
}

/**
 * The minimal web PDF handle: read bytes, expose a page snapshot, and hand the
 * unchanged bytes to the shared save transport. Editing is deliberately absent
 * until the browser engine binding lands, so the slot renders read-only and no
 * fabricated edit success can reach the coordinator.
 */
function createPdfEditorSurface(options: { documentId: string; documents: PdfDocumentsTransport }): PdfEditorSurface {
  let bytes: Uint8Array | null = null;
  let snapshot: PdfSnapshot | null = null;
  let outcome: PdfOpenOutcome | null = null;
  let generation = 0;
  let opening: Promise<void> | null = null;
  let disposed = false;
  const load = async (signal?: AbortSignal) => {
    if (disposed) throw new Error("pdf_editor_disposed");
    opening ??= (async () => {
      const next = bytes ?? await options.documents.read();
      if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
      bytes = next;
      const pageCount = countPdfPages(next);
      snapshot = { pages: Array.from({ length: pageCount }, (_, index) => ({ pageNumber: index + 1, rotation: 0 })), pageCount };
      outcome = { outcome: "opened", document_id: options.documentId, document_model_ref: `web:pdf:${options.documentId}`, warnings: [] };
    })().catch((error: unknown) => { opening = null; throw error; });
    await opening;
  };
  return {
    format: "pdf",
    open: () => load(),
    openOutcome: () => outcome,
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      if (!snapshot) throw new Error("pdf_snapshot_unavailable");
      const value: PdfSnapshot = { pages: snapshot.pages.map((page) => ({ ...page })), pageCount: snapshot.pageCount };
      const fingerprint = await sha256Hex(new TextEncoder().encode(`${options.documentId}:${generation}:${value.pageCount}`));
      return bytes
        ? { generation, fingerprint, value, checksumSha256: await sha256Hex(bytes), sizeBytes: bytes.byteLength }
        : { generation, fingerprint, value };
    },
    async serializeSnapshot() {
      if (!bytes) throw new Error("pdf_editor_not_open");
      return { bytes: bytes.slice(), checksum: await sha256Hex(bytes) };
    },
    getPdfSnapshot: () => (snapshot ? { pages: snapshot.pages.map((page) => ({ ...page })), pageCount: snapshot.pageCount } : null),
    dispose: () => { disposed = true; bytes = null; snapshot = null; outcome = null; generation = 0; },
  };
}

export function createPdfFormatAdapter(options: PdfFormatAdapterOptions) {
  const editor = createPdfEditorSurface({ documentId: options.identity.documentId, documents: options.documents });
  const transport = createPdfSaveTransport({
    documentId: options.identity.documentId,
    documents: options.documents,
    serialize: (snapshot) => editor.serializeSnapshot(snapshot),
  });
  const session = createOfficeEditorSession({ ...options, editor, transport });
  session.coordinator.setCapability(options.capability);
  const open: PdfOpenPort = {
    async open(signal?: AbortSignal, password?: string): Promise<PdfOpenOutcome> {
      void password;
      if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
      try {
        await editor.open();
        if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
        const result = editor.openOutcome();
        if (!result) throw new Error("pdf_open_outcome_missing");
        return result;
      } catch (error) {
        return {
          outcome: "failed", document_id: options.identity.documentId, format: "pdf", failure_class: "engine_error",
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
  // The PDF slot renderer only consumes the editor handle; the shared host
  // adapter is not reached by this lane, so the slot gets a typed placeholder.
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
