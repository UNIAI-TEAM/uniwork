import { createElement, type ReactNode } from "react";
import type { StableSnapshot } from "@uniwork/core/office";
import type { OpenOutcome } from "@uniwork/office-contracts";
import type { DesktopEditorSurface, DesktopSurfaceSettings } from "./surface";

/** The text facets the shared Markdown / HTML views read off an editor handle
 * (structurally `TextEditorHandle` in packages/views/office/source-editor-types). */
export type DesktopTextFacets = {
  source: { getText(): string; setText(text: string): void; subscribe(listener: (text: string) => void): () => void };
  getText(): string;
  setText(text: string): void;
  getAssetManifest(): { entries: [] };
  clipboard?: { readText?(): Promise<string>; writeText?(text: string): Promise<void> };
  cancel(): Promise<void>;
};

export type DesktopTextSurface = DesktopEditorSurface & DesktopTextFacets;

/** Same bound as the web text host: every edit keeps a full copy, so the oldest
 * history goes first once a document has been edited this many times. */
const MAX_UNDO_ENTRIES = 100;
const BOM = [0xef, 0xbb, 0xbf] as const;

function pushBounded(stack: string[], value: string): void {
  stack.push(value);
  if (stack.length > MAX_UNDO_ENTRIES) stack.shift();
}

/** The engine's decode (packages/office-engine/src/assets/text-document.ts):
 * the BOM is an encoding flag, invalid UTF-8 is a failed open, never U+FFFD
 * that a later save would write over the original. */
function decodeSource(bytes: Uint8Array): { text: string; bom: boolean } {
  const bom = bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  return { text, bom };
}

function encodeSource(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set(BOM, 0);
  out.set(body, 3);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

/** Markdown / HTML desktop lane: the document IS its source text. The surface
 * never parses or reformats - decoded text in, the same bytes out - so an
 * unedited open and save writes exactly the original file. It performs no IPC
 * and no network: the byte session owns the save and draft seams. */
export function createDesktopTextSurface(format: "md" | "html", settings: DesktopSurfaceSettings): DesktopTextSurface {
  const offset = settings.generation;
  const modelRef = `desktop-text:${settings.documentId}`;
  const past: string[] = [];
  const future: string[] = [];
  const dirtyListeners = new Set<(generation: number) => void>();
  const textListeners = new Set<(text: string) => void>();
  let text = "";
  let bom = false;
  let edits = 0;
  let isOpen = false;
  let disposed = false;
  let outcome: OpenOutcome | null = null;
  let opening: Promise<void> | null = null;
  let cached: { edits: number; snapshot: StableSnapshot<Uint8Array> } | null = null;

  const changed = () => {
    edits += 1;
    for (const listener of [...textListeners]) listener(text);
    for (const listener of [...dirtyListeners]) listener(offset + edits);
  };
  const setText = (next: string) => {
    if (disposed || settings.readOnly || !isOpen || next === text) return;
    pushBounded(past, text);
    future.length = 0;
    text = next;
    changed();
  };
  const source: DesktopTextFacets["source"] = {
    getText: () => text,
    setText,
    subscribe(listener) { textListeners.add(listener); return () => { textListeners.delete(listener); }; },
  };

  const surface: DesktopTextSurface = {
    format,
    source,
    getText: () => text,
    setText,
    getAssetManifest: () => ({ entries: [] }),
    async cancel() { /* Edits are synchronous: there is no background work to stop. */ },
    async open() {
      if (disposed) throw new Error("text_editor_disposed");
      if (isOpen) return;
      opening ??= (async () => {
        try {
          const decoded = decodeSource(await settings.readBytes());
          if (disposed) throw new Error("text_editor_disposed");
          text = decoded.text;
          bom = decoded.bom;
          edits = 0;
          isOpen = true;
          outcome = { outcome: "opened", document_id: settings.documentId, document_model_ref: modelRef, warnings: [] };
        } catch (error) {
          if (disposed) throw error;
          outcome = { outcome: "failed", document_id: settings.documentId, format, failure_class: "corrupted", message: "text_invalid_utf8" };
          throw Object.assign(new Error("text_invalid_utf8", { cause: error }), { failureClass: "corrupted" });
        }
      })();
      try { await opening; } finally { opening = null; }
    },
    openOutcome: () => outcome,
    getDirtyGeneration: () => offset + edits,
    subscribeDirty(listener) { dirtyListeners.add(listener); return () => { dirtyListeners.delete(listener); }; },
    undo() {
      const previous = past.pop();
      if (previous === undefined || disposed || settings.readOnly) return;
      pushBounded(future, text);
      text = previous;
      changed();
    },
    redo() {
      const next = future.pop();
      if (next === undefined || disposed || settings.readOnly) return;
      pushBounded(past, text);
      text = next;
      changed();
    },
    canUndo: () => !disposed && !settings.readOnly && past.length > 0,
    canRedo: () => !disposed && !settings.readOnly && future.length > 0,
    /** A read-only file has no editor frame (the shared slot hides it), so show
     * the decoded text itself rather than a bare capability notice. */
    renderSurface(): ReactNode {
      return isOpen ? createElement("pre", { className: "min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-body", tabIndex: 0, "data-testid": "readonly-text" }, text) : null;
    },
    async captureSnapshot() {
      if (disposed || !isOpen) throw new Error("text_editor_disposed");
      if (cached?.edits !== edits) {
        const capturedEdits = edits;
        const value = encodeSource(text, bom);
        const hex = await sha256Hex(value);
        if (disposed) throw new Error("text_editor_disposed");
        cached = { edits: capturedEdits, snapshot: { generation: offset + capturedEdits, fingerprint: `sha256:${hex}`, checksumSha256: `sha256:${hex}`, sizeBytes: value.length, value } };
      }
      // Hand out a copy: a caller cannot rewrite the retained snapshot.
      return { ...cached.snapshot, value: cached.snapshot.value.slice() };
    },
    async dispose() {
      disposed = true;
      cached = null;
      past.length = 0;
      future.length = 0;
      dirtyListeners.clear();
      textListeners.clear();
    },
  };
  return surface;
}
