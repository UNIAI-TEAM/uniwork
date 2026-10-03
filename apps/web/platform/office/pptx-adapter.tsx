// UNI-927 (P0-1) — the web PPTX format adapter.
//
// Binds the browser runtime (the generated pptx artifact through
// office-engine's PptxAdapter) to the shared office-editor host: the editor
// handle owns open/capture/restore, the shared coordinator owns the
// serialize -> upload -> commit save, and the interim surface below renders
// the opened deck until P0-2's canvas lands. Save runs in the browser; this
// file never touches a server edit job.
"use client";

import { useSyncExternalStore, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeCapabilityEntry, OfficeIdentity, StableSnapshot } from "@uniwork/core/office";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { cn } from "@uniwork/ui/lib/utils";
import { createOfficeEditorSession, type BrowserOfficeDraftOptions, type OfficeEditorSession } from "./editor-host-core";
import { createPptxSaveTransport, type PptxDocumentsTransport } from "./pptx-save-transport";
import { fingerprintPptxSnapshot, type PptxDeckSnapshot, type PptxSessionRuntime, type PptxSlideSummary } from "./pptx-runtime";

export interface PptxOpenOutcome {
  outcome: "opened" | "failed";
  document_id: string;
  format: "pptx";
  document_model_ref?: string;
  failure_class?: string;
  engine_error?: string;
  message?: string;
}

/** The adapter's editor handle: the shared EditorHandle plus the typed edit
 * channel and the deck view the canvas lanes bind gestures to. */
export interface PptxEditorHandle extends EditorHandle<PptxDeckSnapshot> {
  edit(edits: readonly PptxEdit[]): Promise<{ revision: number }>;
  slides(): PptxSlideSummary[];
  snapshot(): PptxDeckSnapshot | null;
}

export interface PptxFormatAdapterOptions extends BrowserOfficeDraftOptions<PptxDeckSnapshot> {
  identity: OfficeIdentity;
  runtime: PptxSessionRuntime;
  documents: PptxDocumentsTransport;
  capability: OfficeCapabilityEntry;
  readonly?: boolean;
  title?: string;
}

export interface PptxFormatAdapter {
  session: OfficeEditorSession<PptxDeckSnapshot>;
  editor: PptxEditorHandle;
  capability: OfficeCapabilityEntry;
  editorView: ReactNode;
  open: { open(signal?: AbortSignal): Promise<PptxOpenOutcome> };
  onRecoverSnapshot?: (snapshot: StableSnapshot<PptxDeckSnapshot>) => Promise<void>;
}

interface PptxSurfaceView {
  slides: PptxSlideSummary[];
  revision: number;
}

interface PptxRuntimeOpenError extends Error {
  failureClass?: string;
  engineError?: string;
}

function runtimeOpenError(outcome: Awaited<ReturnType<PptxSessionRuntime["open"]>>): PptxRuntimeOpenError {
  const error = new Error(outcome.message ?? outcome.failure_class ?? outcome.engine_error ?? "pptx_open_failed") as PptxRuntimeOpenError;
  error.failureClass = outcome.failure_class;
  error.engineError = outcome.engine_error;
  return error;
}

/** Interim deck surface (P0-2 replaces it with the render canvas): the slide
 * rail and the selected slide's element list, read from the live model. */
function PptxSessionSurface(props: { view: () => PptxSurfaceView | null; subscribe: (listener: () => void) => () => void }): ReactNode {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const current = useSyncExternalStore(props.subscribe, props.view, props.view);
  const [selected, setSelected] = useState(0);
  if (!current) return null;
  const bounded = Math.min(selected, Math.max(current.slides.length - 1, 0));
  const slide = current.slides[bounded];
  return (
    <section data-pptx-session-surface className="flex min-h-0 flex-1 flex-col gap-3 rounded-panel border border-border bg-background p-3">
      <div className="flex items-center justify-between text-caption text-muted-foreground">
        <span>{t("slide_rail_label")}</span>
        <span data-pptx-revision={current.revision}>{t("slide_position", { current: current.slides.length ? bounded + 1 : 0, total: current.slides.length })}</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <ol aria-label={t("slide_rail_label")} className="flex w-44 shrink-0 flex-col gap-1 overflow-auto" data-pptx-slide-rail>
          {current.slides.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={index === bounded}
                onClick={() => setSelected(index)}
                className={cn("w-full rounded-md border border-border px-2 py-1 text-left text-body", index === bounded ? "bg-muted" : "bg-background")}
                data-pptx-slide-index={index}
              >
                {t("slide_number", { index: index + 1 })}
              </button>
            </li>
          ))}
        </ol>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- role=application is the keyboard deck surface, same as the shared PptxEditor */}
        <div role="application" aria-label={t("canvas_label")} tabIndex={0} className="flex min-h-48 flex-1 items-center justify-center overflow-auto rounded-md border border-border bg-muted/10 p-4" data-pptx-canvas>
          {current.slides.length === 0 ? (
            <p className="text-body text-muted-foreground">{t("no_slides")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-caption text-muted-foreground">
              {(slide?.elements ?? []).map((element) => (
                <li key={element.id} data-element-id={element.id}>{element.type}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function createPptxFormatAdapter(options: PptxFormatAdapterOptions): PptxFormatAdapter {
  let modelRef: string | null = null;
  let openedBytes: Uint8Array | null = null;
  let opening: Promise<void> | null = null;
  let generation = 0;
  let disposed = false;
  let view: PptxSurfaceView | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getView = () => view;
  const refreshView = () => {
    view = modelRef && !disposed ? { slides: options.runtime.slides(modelRef), revision: options.runtime.snapshot(modelRef).revision } : null;
    for (const listener of listeners) listener();
  };

  const editor: PptxEditorHandle = {
    format: "pptx",
    async open() {
      if (disposed) throw new Error("pptx_editor_disposed");
      if (opening) return opening;
      if (modelRef) return;
      opening = (async () => {
        const bytes = openedBytes ?? (await options.documents.read());
        if (disposed) throw new Error("pptx_editor_disposed");
        openedBytes = bytes;
        const outcome = await options.runtime.open({ bytes, documentId: options.identity.documentId });
        if (disposed) {
          if (outcome.document_model_ref) await options.runtime.release(outcome.document_model_ref);
          throw new Error("pptx_editor_disposed");
        }
        if (outcome.outcome !== "opened") throw runtimeOpenError(outcome);
        if (!outcome.document_model_ref) throw new Error("pptx_open_missing_model_ref");
        modelRef = outcome.document_model_ref;
        // Opening a deck establishes the clean baseline; the identity
        // generation is the auth/session generation, not a content edit.
        generation = 0;
        refreshView();
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
      refreshView();
      listeners.clear();
    },
    async edit(edits) {
      if (disposed) throw new Error("pptx_editor_disposed");
      if (!modelRef) throw new Error("pptx_editor_not_open");
      const result = await options.runtime.edit(modelRef, edits);
      generation += 1;
      // One applied edit is one dirty generation: the editor handle owns the
      // counter, so a caller cannot apply an edit the coordinator never sees.
      session.coordinator.markDirty(generation);
      refreshView();
      return result;
    },
    slides: () => (modelRef && !disposed ? options.runtime.slides(modelRef) : []),
    snapshot: () => (modelRef && !disposed ? options.runtime.snapshot(modelRef) : null),
  };

  const transport = createPptxSaveTransport({
    documentId: options.identity.documentId,
    documents: options.documents,
    serialize: async (snapshot) => {
      if (!modelRef) throw new Error("pptx_editor_not_open");
      return options.runtime.serialize(modelRef, { snapshot });
    },
  });
  const session = createOfficeEditorSession({ ...options, editor, transport });
  session.coordinator.setCapability(options.capability);

  const open = {
    async open(signal?: AbortSignal): Promise<PptxOpenOutcome> {
      if (signal?.aborted) {
        return { outcome: "failed", document_id: options.identity.documentId, format: "pptx", failure_class: "engine_error", message: "open cancelled" };
      }
      try {
        await editor.open();
        return { outcome: "opened", document_id: options.identity.documentId, format: "pptx", ...(modelRef ? { document_model_ref: modelRef } : {}) };
      } catch (error) {
        const typed = error as Partial<PptxRuntimeOpenError>;
        return {
          outcome: "failed",
          document_id: options.identity.documentId,
          format: "pptx",
          failure_class: typed.failureClass ?? "engine_error",
          ...(typed.engineError ? { engine_error: typed.engineError } : {}),
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  const onRecoverSnapshot = options.runtime.restore
    ? async (snapshot: StableSnapshot<PptxDeckSnapshot>): Promise<void> => {
        if (disposed) throw new Error("pptx_editor_disposed");
        if (!modelRef) await editor.open();
        if (!modelRef || !options.runtime.restore) throw new Error("pptx_editor_not_open");
        await options.runtime.restore(modelRef, snapshot.value);
        generation = Math.max(generation, snapshot.generation);
        refreshView();
      }
    : undefined;

  return {
    session,
    editor,
    capability: options.capability,
    editorView: <PptxSessionSurface view={getView} subscribe={subscribe} />,
    open,
    onRecoverSnapshot,
  };
}
