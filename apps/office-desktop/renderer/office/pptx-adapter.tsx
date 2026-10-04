// UNI-927 D1 - the desktop PPTX format adapter.
//
// The desktop host needs the editor handle and the opened deck the shared
// PptxEditorView mounts; it does NOT need the web adapter's IndexedDB draft
// session (the desktop draft store lives in main and crosses typed IPC). This
// adapter therefore owns only open/snapshot/edit/history on the desktop
// runtime, and the session module binds the shared save coordinator to it.
"use client";

import type { EditorHandle, OfficeCapabilityEntry, OfficeIdentity, StableSnapshot } from "@uniwork/core/office";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import type { PptxDeckModel } from "@uniwork/views/office/pptx";
import { fingerprintPptxSnapshot, type PptxDeckSnapshot, type PptxSessionRuntime, type PptxSlideSummary } from "./pptx-runtime";

export interface DesktopPptxOpenOutcome {
  outcome: "opened" | "failed";
  document_id: string;
  format: "pptx";
  document_model_ref?: string;
  failure_class?: string;
  engine_error?: string;
  message?: string;
}

/** The adapter's editor handle: the shared EditorHandle plus the typed edit
 * channel and the deck view the canvas binds gestures to. */
export interface DesktopPptxEditorHandle extends EditorHandle<PptxDeckSnapshot> {
  edit(edits: readonly PptxEdit[]): Promise<{ revision: number }>;
  slides(): PptxSlideSummary[];
  snapshot(): PptxDeckSnapshot | null;
  /** The opened engine deck the shared canvas renders (null before open). */
  deck(): PptxDeckModel | null;
  /** Speaker-notes text of one slide of the LIVE session ('' when the slide has
   *  none); null once the session is released/disposed (UNI-927 NOTES-WIRE). */
  slideNotes(slideIndex: number): string | null;
  /** Replay a recovered draft journal onto the freshly opened base. */
  restore(snapshot: PptxDeckSnapshot): Promise<void>;
  /** Serialize the current model to pptx bytes (the renderer save path). */
  serialize(snapshot: StableSnapshot<PptxDeckSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
  /** Bumps whenever an edit or history replay lands, so the canvas rebuilds. */
  revision(): number;
  undo(): void;
  redo(): void;
}

export interface DesktopPptxAdapterOptions {
  identity: OfficeIdentity;
  runtime: PptxSessionRuntime;
  /** The opened bytes: main already read them behind the typed IPC seam. */
  readBytes(): Promise<Uint8Array>;
  capability: OfficeCapabilityEntry;
  readonly?: boolean;
  /** One applied edit is one dirty generation; the session forwards it to the
   *  shared coordinator so a save always sees the change. */
  onDirty?(generation: number): void;
}

export interface DesktopPptxAdapter {
  editor: DesktopPptxEditorHandle;
  open(signal?: AbortSignal): Promise<DesktopPptxOpenOutcome>;
  readonly capability: OfficeCapabilityEntry;
}

export function createDesktopPptxAdapter(options: DesktopPptxAdapterOptions): DesktopPptxAdapter {
  let modelRef: string | null = null;
  let opening: Promise<void> | null = null;
  let generation = 0;
  let revision = 0;
  let disposed = false;
  let viewRevision = 0;

  const editor: DesktopPptxEditorHandle = {
    format: "pptx",
    async open() {
      if (disposed) throw new Error("pptx_editor_disposed");
      if (opening) return opening;
      if (modelRef) return;
      opening = (async () => {
        const bytes = await options.readBytes();
        if (disposed) throw new Error("pptx_editor_disposed");
        const outcome = await options.runtime.open({ bytes, documentId: options.identity.documentId });
        if (disposed) {
          if (outcome.document_model_ref) await options.runtime.release(outcome.document_model_ref);
          throw new Error("pptx_editor_disposed");
        }
        if (outcome.outcome !== "opened") throw new Error(outcome.message ?? outcome.failure_class ?? outcome.engine_error ?? "pptx_open_failed");
        if (!outcome.document_model_ref) throw new Error("pptx_open_missing_model_ref");
        modelRef = outcome.document_model_ref;
        generation = 0;
        revision = options.runtime.snapshot(modelRef).revision;
      })();
      try {
        await opening;
      } finally {
        opening = null;
      }
    },
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      if (!modelRef) throw new Error("pptx_snapshot_unavailable");
      const value = options.runtime.snapshot(modelRef);
      return { generation, fingerprint: await fingerprintPptxSnapshot(value), value };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (modelRef) await options.runtime.release(modelRef);
      modelRef = null;
    },
    async edit(edits) {
      if (disposed) throw new Error("pptx_editor_disposed");
      if (options.readonly) throw new Error("pptx_editor_readonly");
      if (!modelRef) throw new Error("pptx_editor_not_open");
      const result = await options.runtime.edit(modelRef, edits);
      generation += 1;
      revision = result.revision;
      viewRevision += 1;
      options.onDirty?.(generation);
      return result;
    },
    // Journal-backed history. The shared EditorHandle methods return void, so
    // each advances the dirty generation and the canvas revision on success.
    undo() {
      if (disposed || !modelRef) return;
      const ref = modelRef;
      void options.runtime.undo(ref).then((applied) => {
        if (!applied || disposed || modelRef !== ref) return;
        generation += 1;
        revision = options.runtime.snapshot(ref).revision;
        viewRevision += 1;
        options.onDirty?.(generation);
      }).catch(() => undefined);
    },
    redo() {
      if (disposed || !modelRef) return;
      const ref = modelRef;
      void options.runtime.redo(ref).then((applied) => {
        if (!applied || disposed || modelRef !== ref) return;
        generation += 1;
        revision = options.runtime.snapshot(ref).revision;
        viewRevision += 1;
        options.onDirty?.(generation);
      }).catch(() => undefined);
    },
    async restore(snapshot) {
      if (disposed) throw new Error("pptx_editor_disposed");
      if (!modelRef) await editor.open();
      if (!modelRef || disposed) throw new Error("pptx_editor_not_open");
      await options.runtime.restore?.(modelRef, snapshot);
      generation = Math.max(generation, snapshot.revision);
      revision = options.runtime.snapshot(modelRef).revision;
      viewRevision += 1;
      options.onDirty?.(generation);
    },
    async serialize(snapshot) {
      if (disposed) throw new Error("pptx_editor_disposed");
      if (!modelRef) throw new Error("pptx_editor_not_open");
      return options.runtime.serialize(modelRef, { snapshot });
    },
    slides: () => (modelRef && !disposed ? options.runtime.slides(modelRef) : []),
    snapshot: () => (modelRef && !disposed ? options.runtime.snapshot(modelRef) : null),
    deck: () => (modelRef && !disposed ? options.runtime.deck(modelRef) : null),
    // UNI-927 NOTES-WIRE: the presenter reads the LIVE session's notes through
    // this port; a released session answers null (the honest empty-notes line).
    slideNotes: (slideIndex) => (modelRef && !disposed ? options.runtime.slideNotes?.(modelRef, slideIndex) ?? null : null),
    revision: () => viewRevision,
  };

  return {
    editor,
    capability: options.capability,
    async open(signal?: AbortSignal): Promise<DesktopPptxOpenOutcome> {
      if (signal?.aborted) return { outcome: "failed", document_id: options.identity.documentId, format: "pptx", failure_class: "engine_error", message: "open cancelled" };
      try {
        await editor.open();
        return { outcome: "opened", document_id: options.identity.documentId, format: "pptx", ...(modelRef ? { document_model_ref: modelRef } : {}) };
      } catch (error) {
        return { outcome: "failed", document_id: options.identity.documentId, format: "pptx", failure_class: "engine_error", message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export type { StableSnapshot };
