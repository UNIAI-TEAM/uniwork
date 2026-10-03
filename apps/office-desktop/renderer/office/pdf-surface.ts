import { bridgePdfOperations, type PdfEditOperation, type PdfEditorHandle, type PdfOpenOutcome, type PdfPage, type PdfSelectionPort, type PdfSnapshot } from "@uniwork/views/office/pdf";
import type { DesktopDocumentFormat } from "../../shared/document-formats";
import type { DesktopIpcRequest } from "../../shared/ipc";
import type { DesktopSurfaceSettings } from "./surface";

type EngineResponse = {
  ok: boolean;
  probe?: { pageCount: number };
  dataBase64?: string;
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

function pages(count: number): PdfPage[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({ pageNumber: index + 1, rotation: 0 }));
}

export function createDesktopPdfSurface(settings: DesktopSurfaceSettings): PdfEditorHandle<Uint8Array> & {
  format: DesktopDocumentFormat;
  openOutcome(): PdfOpenOutcome | null;
  subscribeDirty(listener: (generation: number) => void): () => void;
  getPdfSnapshot(): PdfSnapshot | null;
  selection: PdfSelectionPort;
  edit(operations: readonly unknown[]): Promise<void>;
} {
  let bytes: Uint8Array = Uint8Array.from([]);
  let generation = settings.generation;
  let snapshot: PdfSnapshot | null = null;
  let outcome: PdfOpenOutcome | null = null;
  let disposed = false;
  const listeners = new Set<(generation: number) => void>();
  let selected: Parameters<NonNullable<PdfSelectionPort["setSelection"]>>[0] = null;
  const selection: PdfSelectionPort = {
    getSelection: () => selected,
    setSelection: (next) => { selected = next ?? null; },
    subscribe: (listener) => { listener(selected); return () => undefined; },
  };
  const callEngine = async (operation: "open" | "edit", args: Record<string, unknown>): Promise<EngineResponse> => {
    const payload: DesktopIpcRequest<"desktop:engine-call"> = { sessionGeneration: settings.sessionGeneration, operation, handle: settings.documentId, args };
    return await settings.bridge.call("desktop:engine-call", payload) as EngineResponse;
  };
  const surface = {
    format: "pdf" as const,
    async open() {
      if (disposed) throw new Error("pdf_surface_disposed");
      bytes = Uint8Array.from(await settings.readBytes());
      const result = await callEngine("open", { dataBase64: encodeBase64(bytes) });
      if (!result.ok || !result.probe) throw new Error("pdf_open_failed");
      snapshot = { pages: pages(result.probe.pageCount), pageCount: result.probe.pageCount };
      outcome = { outcome: "opened", document_id: settings.documentId, document_model_ref: `desktop:pdf:${settings.documentId}`, warnings: [] };
    },
    openOutcome: () => outcome,
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      const fingerprint = `pdf:${bytes.byteLength}:${generation}`;
      return { generation, fingerprint, value: bytes.slice(), sizeBytes: bytes.byteLength };
    },
    async edit(operations: readonly unknown[]) {
      if (settings.readOnly) throw new Error("pdf_readonly");
      const edits = await bridgePdfOperations(operations as readonly PdfEditOperation[]);
      const result = await callEngine("edit", { dataBase64: encodeBase64(bytes), edits: [...edits] });
      if (!result.ok || !result.dataBase64) throw new Error("pdf_edit_failed");
      bytes = Uint8Array.from(decodeBase64(result.dataBase64));
      generation += 1;
      for (const listener of listeners) listener(generation);
    },
    getPdfSnapshot: () => snapshot,
    selection,
    subscribeDirty: (listener: (next: number) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    dispose: () => { disposed = true; listeners.clear(); bytes = Uint8Array.from([]); snapshot = null; },
  };
  return surface;
}
