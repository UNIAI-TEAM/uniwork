// UNI-927 (P0-1, WIRE-WEB) - the web PPTX format adapter.
//
// Binds the browser runtime (the generated pptx artifact through
// office-engine's PptxAdapter) to the shared office-editor host: the editor
// handle owns open/capture/restore, the shared coordinator owns the
// serialize -> upload -> commit save, and `editorView` mounts the REAL shared
// PptxEditor canvas with the opened deck. Save runs in the browser; this file
// never touches a server edit job.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeCapabilityEntry, OfficeHost, OfficeIdentity, StableSnapshot } from "@uniwork/core/office";
import { isPptxSessionDiverged, type PptxEdit, type PptxParagraphLike, type PptxSlideAnimationRead, type PptxSlideTransitionRead } from "@uniwork/office-engine/pptx";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import { PptxEditor } from "@uniwork/views/office/pptx/editor-view";
import type { PptxDeckModel } from "@uniwork/views/office/pptx";
import type { PptxSlideView } from "@uniwork/views/office/pptx/slide-rail";
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
 * channel, the deck view the canvas renders and the revision the canvas keys
 * its rendition cache on. */
export interface PptxEditorHandle extends EditorHandle<PptxDeckSnapshot> {
  /** `createdIds`: element ids the edits minted, so the editor can select a new insert. */
  edit(edits: readonly PptxEdit[]): Promise<{ revision: number; createdIds?: string[] }>;
  slides(): PptxSlideSummary[];
  snapshot(): PptxDeckSnapshot | null;
  /** The opened engine deck the shared canvas renders (null before open). */
  deck(): PptxDeckModel | null;
  /** Bumps on every applied edit / undo / redo / restore, so the canvas and the
   *  rail thumbnails rebuild exactly when the model moved. */
  /** Transition + auto-advance of a LIVE slide; null once released (X1, R2-1). */
  slideTransition(slideIndex: number): PptxSlideTransitionRead | null;
  /** Animation timeline of a LIVE slide, play order; null once released (X1, R2-2). */
  slideAnimations(slideIndex: number): PptxSlideAnimationRead[] | null;
  revision(): number;
  /** Journal-backed history on the runtime (narrows the optional EditorHandle
   *  methods to required, so the ribbon can rely on them existing). */
  undo(): void;
  redo(): void;
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
  deck: PptxDeckModel | null;
  revision: number;
}

type PptxOpenPhase = "loading" | "ready" | "error";

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

/** Plain text of every element on every slide of the opaque deck model. The
 * model is owned by the artifact; this walker only reads the documented
 * `text.paragraphs[].runs[].text` shape the render tree already consumes. */
function deckSlideTexts(deck: PptxDeckModel | null): string[] {
  if (!deck) return [];
  return deck.slides.map((slide) => {
    const elements = (slide as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) return "";
    return elements
      .map((element) => {
        const paragraphs = (element as { text?: { paragraphs?: unknown } }).text?.paragraphs;
        if (!Array.isArray(paragraphs)) return "";
        return paragraphs
          .map((paragraph) => {
            const runs = (paragraph as { runs?: unknown }).runs;
            if (!Array.isArray(runs)) return "";
            return runs.map((run) => (run as { text?: string }).text ?? "").join("");
          })
          .join("\n");
      })
      .join("\n");
  });
}

/** The web host's OfficeHost for the shared editor. The browser host owns no
 * read/write port (the adapter reads the bytes itself and save goes through the
 * coordinator), so both refuse by name instead of fabricating an open or
 * handing back a blank package; the one bound ipc channel is the slides
 * transform gesture -> the typed edit channel, bound only while editable. */
export function makePptxEditorHost(editor: PptxEditorHandle, editable: boolean): OfficeHost {
  return {
    read: {
      // Unbound on purpose: the bytes come from documents.read() in editor.open,
      // so a caller here gets a typed refusal, never an empty Uint8Array.
      readDocument: async () => { throw new HostCapabilityRefusal("host:read-document", "unsupported", "the web host reads bytes through the adapter, not the shared host read port"); },
      // Open runs through the adapter editor, so a fabricated success (a bogus
      // document_model_ref) would be a lie about a model that does not exist.
      // openDocument owns a failure channel (the contract's OpenOutcome), so
      // the refusal is that named failure - never a thrown surprise, never a
      // fabricated "opened".
      openDocument: async (documentId, format) => ({
        outcome: "failed" as const,
        document_id: documentId,
        format,
        failure_class: "unsupported_feature" as const,
        message: "the web host opens through the adapter editor, not the shared host read port",
      }),
    },
    write: { writeOutput: async () => { throw new Error("use_save_coordinator"); } },
    assets: { resolveFont: async () => null, resolveImage: async () => null, resolveAsset: async () => null },
    ipc: {
      call: (async (channel: string, body: unknown) => {
        if (channel === "host:slides-edit-transform") {
          if (!editable) throw new HostCapabilityRefusal("host:slides-edit-transform", "policy", "the document is readonly");
          const request = body as SlidesEditTransformRequest;
          if (!request.sourceId) throw new Error("pptx_transform_needs_element");
          await editor.edit([{
            op: "edit_transform",
            slideIndex: request.slideIndex,
            elementId: request.sourceId,
            xPx: request.xPx,
            yPx: request.yPx,
            wPx: request.wPx,
            hPx: request.hPx,
            ...(request.rotationDeg === undefined ? {} : { rotationDeg: request.rotationDeg }),
            ...(request.fitWidthPx == null ? {} : { fitWidthPx: request.fitWidthPx }),
            ...(request.groupId ? { groupId: request.groupId } : {}),
          }]);
          return {};
        }
        throw new Error("host_operation_unbound:" + channel);
      }) as OfficeHost["ipc"]["call"],
      send: () => undefined,
      subscribe: () => () => undefined,
    },
  };
}

/** The mounted editor surface: opens the deck through the adapter, then renders
 * the real shared canvas with the live deck, revision, slide list and the edit
 * ports the demo core flow needs. */
function PptxEditorSurface(props: {
  view: () => PptxSurfaceView | null;
  subscribe: (listener: () => void) => () => void;
  editor: PptxEditorHandle;
  coordinator: OfficeEditorSession<PptxDeckSnapshot>["coordinator"];
  /** A readonly document binds no edit port at all (F6). */
  editable: boolean;
  open: (signal?: AbortSignal) => Promise<PptxOpenOutcome>;
  /** Speaker-notes read of the live session (UNI-927 NOTES-WIRE). */
  slideNotes: (slideIndex: number) => string | null;
  /** Layout catalog of the live package (empty once released). */
  slideLayouts: () => { name: string; path: string }[];
}): ReactNode {
  const { t } = useTranslation();
  // F7: the open effect must not restart on a fresh `t` identity. react-i18next
  // memoizes `t`, but a host or a test double that hands back a new translator
  // per render would otherwise re-open the document on every commit - an
  // endless loading/ready loop. Read the translator through a ref, the same
  // seam-stabilization the deck renderer and the editor use.
  const tRef = useRef(t);
  tRef.current = t;
  const { editor, coordinator, editable, open, view, subscribe, slideNotes, slideLayouts } = props;
  const current = useSyncExternalStore(subscribe, view, view);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<PptxOpenPhase>("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setPhase("loading");
    setFailure(null);
    void open(controller.signal).then((outcome) => {
      if (!active) return;
      if (outcome.outcome === "opened") {
        setPhase("ready");
        return;
      }
      setPhase("error");
      setFailure(outcome.message ?? outcome.failure_class ?? tRef.current("office.editor.open_error_hint"));
    }).catch((error: unknown) => {
      if (!active) return;
      setPhase("error");
      setFailure(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; controller.abort(); };
  }, [attempt, open]);

  const host = useMemo(() => makePptxEditorHost(editor, editable), [editable, editor]);
  // The session (OfficeEditorHost unmount) owns disposal. The canvas disposes
  // the handle it is given on its own unmount, and under StrictMode that
  // simulated unmount would release the live model, so it gets a handle whose
  // dispose is inert.
  const viewHandle = useMemo<PptxEditorHandle>(() => ({ ...editor, dispose: async () => undefined }), [editor]);

  const slides = useMemo<readonly PptxSlideView[]>(
    () => (current?.slides ?? []).map((slide, index) => ({ id: slide.id, label: String(index + 1), ...(slide.hidden ? { hidden: true } : {}) })),
    [current],
  );
  const deck = useMemo(
    () => (current?.deck ? { deck: current.deck, revision: current.revision } : {}),
    [current],
  );

  const commitText = useCallback(
    (commit: { slideIndex: number; elementId: string; paragraphs: PptxParagraphLike[] }) =>
      editor.edit([{ op: "edit_text", slideIndex: commit.slideIndex, elementId: commit.elementId, paragraphs: commit.paragraphs }]),
    [editor],
  );
  const transform = useCallback(
    (request: SlidesEditTransformRequest) => {
      if (!request.sourceId) throw new Error("pptx_transform_needs_element");
      return editor.edit([{
        op: "edit_transform",
        slideIndex: request.slideIndex,
        elementId: request.sourceId,
        xPx: request.xPx,
        yPx: request.yPx,
        wPx: request.wPx,
        hPx: request.hPx,
        ...(request.rotationDeg === undefined ? {} : { rotationDeg: request.rotationDeg }),
        ...(request.fitWidthPx == null ? {} : { fitWidthPx: request.fitWidthPx }),
        ...(request.groupId ? { groupId: request.groupId } : {}),
      }]);
    },
    [editor],
  );
  // WIRE-KINDS (d3890c0a) registered FormatEdit in the PptxEdit union, so the
  // panel edit union IS PptxEdit and no cast is needed.
  const applyEdit = useCallback((edit: PptxEdit) => editor.edit([edit]), [editor]);
  const deleteElements = useCallback(
    (slideIndex: number, elementIds: readonly string[]) =>
      editor.edit(elementIds.map((elementId) => ({ op: "delete_element" as const, slideIndex, elementId }))),
    [editor],
  );
  // F4 seam: the shared PptxEditor exposes no selection-aware text-edit port -
  // the in-place layer is bound through onCommitText (double-click / context
  // "Edit Text"), and onTextEdit is only its no-selection fallback. Binding
  // onTextEdit to a no-op would light the ribbon Text command while doing
  // nothing, so it stays unbound and the shared editor honestly disables
  // edit-text; the dead commandCapabilities["edit-text"] entry is gone.
  // Follow-up row: add a selection-aware text port to PptxEditor and bind it
  // here. F6: a readonly document binds NO edit port at all (below), so no
  // in-place layer opens over a document whose commit would be refused.
  // F7: the deck texts are memoized on the published view instead of rescanned
  // per keystroke. The view object is replaced on every applied edit / undo /
  // redo / restore (the deck itself mutates in place), so the memo refreshes
  // exactly when the model moved.
  const deckText = useMemo(() => deckSlideTexts(current?.deck ?? null), [current]);
  // A real find: jump the editor to the first slide whose text carries the query.
  const find = useCallback((query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const index = deckText.findIndex((text) => text.toLowerCase().includes(needle));
    if (index >= 0) setSelected(index);
  }, [deckText]);

  if (phase !== "ready") {
    return (
      <div className="flex min-h-64 flex-col gap-3 rounded-panel border border-border bg-background p-4" role="status" aria-live="polite" aria-busy={phase === "loading"} data-pptx-open-state={phase}>
        <p className="text-body text-muted-foreground">
          {phase === "loading" ? t("office.pptx.state.opening") : t("office.editor.open_error")}
        </p>
        {phase === "error" ? (
          <>
            <p className="text-caption text-muted-foreground" role="alert">{t("office.editor.open_error_hint")}{failure ? ` ${failure}` : ""}</p>
            <button type="button" className="self-start rounded-md border border-border px-3 py-1 text-body" onClick={() => setAttempt((value) => value + 1)}>
              {t("office.editor.retry")}
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <PptxEditor
      host={host}
      editorHandle={viewHandle}
      slides={slides}
      deck={deck}
      selectedIndex={selected}
      onSlideSelect={setSelected}
      // F6: readonly binds no edit port (text/transform/panel/delete); find and
      // slide selection stay live because they never mutate the deck.
      {...(editable ? { onCommitText: commitText, onTransform: transform, onApplyEdit: applyEdit, onDeleteElements: deleteElements } : {})}
      onFind={find}
      slideNotes={slideNotes}
      slideLayouts={slideLayouts}
      saveCoordinator={coordinator}
      includeSave={false}
    />
  );
}

export function createPptxFormatAdapter(options: PptxFormatAdapterOptions): PptxFormatAdapter {
  let modelRef: string | null = null;
  let openedBytes: Uint8Array | null = null;
  let opening: Promise<void> | null = null;
  let generation = 0;
  let disposed = false;
  // Set the moment the deferred dispose fires. `originalDispose` awaits the
  // draft before `editor.dispose()` sets `disposed`, and an open() landing in
  // that gap would report "opened" on a model about to be released.
  let disposeStarted = false;
  // StrictMode (next dev) runs mount -> cleanup -> mount on a fresh tree: the
  // cleanup disposes the session and the remount opens it again. Disposal is
  // therefore deferred one task and cancelled by the next open(), so the
  // remount revives the live session instead of reading a disposed one.
  let cancelPendingDispose: () => void = () => undefined;
  let viewRevision = 0;
  let view: PptxSurfaceView | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getView = () => view;
  const refreshView = () => {
    view = modelRef && !disposed
      ? { slides: options.runtime.slides(modelRef), deck: options.runtime.deck(modelRef), revision: viewRevision }
      : null;
    for (const listener of listeners) listener();
  };

  const editor: PptxEditorHandle = {
    format: "pptx",
    async open() {
      cancelPendingDispose();
      if (disposed || disposeStarted) throw new Error("pptx_editor_disposed");
      if (opening) return opening;
      if (modelRef) return;
      opening = (async () => {
        const bytes = openedBytes ?? (await options.documents.read());
        if (disposed || disposeStarted) throw new Error("pptx_editor_disposed");
        openedBytes = bytes;
        const outcome = await options.runtime.open({ bytes, documentId: options.identity.documentId });
        if (disposed || disposeStarted) {
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
      // A readonly document has no edit surface; refuse before the model is
      // touched so the deck can never carry unsavable dirty state.
      if (options.readonly) throw new Error("pptx_editor_readonly");
      if (!modelRef) throw new Error("pptx_editor_not_open");
      const result = await options.runtime.edit(modelRef, edits);
      generation += 1;
      viewRevision += 1;
      // One applied edit is one dirty generation: the editor handle owns the
      // counter, so a caller cannot apply an edit the coordinator never sees.
      session.coordinator.markDirty(generation);
      refreshView();
      return result;
    },
    // Journal-backed history. The shared EditorHandle methods return void, so
    // each runs on the runtime's serialized lane and publishes its result by
    // advancing the dirty generation (a content change the coordinator must
    // still save) and republishing the deck view. A refused replay that left
    // the model untouched is swallowed: the shared void contract has no error
    // channel. A diverged session (W12: the replay failed after the engine
    // swap, so the model no longer matches the journal) is not: it is marked
    // dirty, so the coordinator's save runs and fails loudly with
    // pptx_session_diverged instead of the deck silently looking undone.
    undo() {
      if (disposed || !modelRef) return;
      const ref = modelRef;
      void options.runtime.undo(ref).then((applied) => {
        if (applied) historyMoved(ref);
      }).catch((error: unknown) => {
        if (isPptxSessionDiverged(error)) historyMoved(ref);
      });
    },
    redo() {
      if (disposed || !modelRef) return;
      const ref = modelRef;
      void options.runtime.redo(ref).then((applied) => {
        if (applied) historyMoved(ref);
      }).catch((error: unknown) => {
        if (isPptxSessionDiverged(error)) historyMoved(ref);
      });
    },
    slides: () => (modelRef && !disposed ? options.runtime.slides(modelRef) : []),
    slideTransition: (slideIndex) => (modelRef && !disposed ? options.runtime.slideTransition?.(modelRef, slideIndex) ?? null : null),
    slideAnimations: (slideIndex) => (modelRef && !disposed ? options.runtime.slideAnimations?.(modelRef, slideIndex) ?? null : null),
    snapshot: () => (modelRef && !disposed ? options.runtime.snapshot(modelRef) : null),
    deck: () => (modelRef && !disposed ? options.runtime.deck(modelRef) : null),
    revision: () => viewRevision,
  };

  /** One history move (or a divergence) is a content change the coordinator must save. */
  function historyMoved(ref: string): void {
    if (disposed || modelRef !== ref) return;
    generation += 1;
    viewRevision += 1;
    session.coordinator.markDirty(generation);
    refreshView();
  }

  // UNI-927 NOTES-WIRE: the presenter's notes come from the LIVE session; a
  // released/disposed session reads null (the honest empty-notes line) instead
  // of reaching a freed engine ref.
  const slideNotes = (slideIndex: number): string | null =>
    (modelRef && !disposed ? options.runtime.slideNotes?.(modelRef, slideIndex) ?? null : null);

  // The layout catalog of the LIVE package, same guard as the notes read: a
  // released session answers [] (the sorter then offers only its blank slide).
  const slideLayouts = (): { name: string; path: string }[] =>
    (modelRef && !disposed ? options.runtime.slideLayouts?.(modelRef) ?? [] : []);

  const transport = createPptxSaveTransport({
    documentId: options.identity.documentId,
    documents: options.documents,
    serialize: async (snapshot, intentId) => {
      if (!modelRef) throw new Error("pptx_editor_not_open");
      return options.runtime.serialize(modelRef, { snapshot, intentId });
    },
    setBaseRevision: async (revision, intentId) => {
      if (modelRef) await options.runtime.setBaseRevision?.(modelRef, revision, intentId);
    },
    releaseSave: async (intentId) => {
      if (modelRef) await options.runtime.releaseSave?.(modelRef, intentId);
    },
  });
  const session = createOfficeEditorSession({ ...options, editor, transport });
  session.coordinator.setCapability(options.capability);
  const originalDispose = session.dispose;
  let disposal: Promise<void> | null = null;
  session.dispose = () => {
    if (disposal) return disposal;
    disposal = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cancelPendingDispose = () => undefined;
        disposeStarted = true;
        originalDispose().then(resolve, reject);
      }, 0);
      cancelPendingDispose = () => {
        clearTimeout(timer);
        cancelPendingDispose = () => undefined;
        disposal = null;
        resolve();
      };
    });
    return disposal;
  };

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
        viewRevision += 1;
        refreshView();
      }
    : undefined;

  return {
    session,
    editor,
    capability: options.capability,
    editorView: (
      <PptxEditorSurface
        view={getView}
        subscribe={subscribe}
        editor={editor}
        coordinator={session.coordinator}
        editable={options.readonly !== true}
        open={open.open}
        slideNotes={slideNotes}
        slideLayouts={slideLayouts}
      />
    ),
    open,
    onRecoverSnapshot,
  };
}
