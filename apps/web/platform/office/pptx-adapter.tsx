// UNI-927 (P0-1, WIRE-WEB) - the web PPTX format adapter.
//
// Binds the browser runtime (the generated pptx artifact through
// office-engine's PptxAdapter) to the shared office-editor host: the editor
// handle owns open/capture/restore, the shared coordinator owns the
// serialize -> upload -> commit save, and `editorView` mounts the REAL shared
// PptxEditor canvas with the opened deck. Save runs in the browser; this file
// never touches a server edit job.
"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeCapabilityEntry, OfficeHost, OfficeIdentity, StableSnapshot } from "@uniwork/core/office";
import type { FormatEdit, PptxEdit, PptxParagraphLike } from "@uniwork/office-engine/pptx";
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
  edit(edits: readonly PptxEdit[]): Promise<{ revision: number }>;
  slides(): PptxSlideSummary[];
  snapshot(): PptxDeckSnapshot | null;
  /** The opened engine deck the shared canvas renders (null before open). */
  deck(): PptxDeckModel | null;
  /** Bumps on every applied edit / undo / redo / restore, so the canvas and the
   *  rail thumbnails rebuild exactly when the model moved. */
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

/** The web host's OfficeHost for the shared editor: read/write/assets are the
 * adapter's own ports (save goes through the coordinator), and the one bound
 * ipc channel is the slides transform gesture -> the typed edit channel. */
function makePptxEditorHost(editor: PptxEditorHandle, documentId: string): OfficeHost {
  return {
    read: {
      readDocument: async () => new Uint8Array(),
      openDocument: async () => ({ outcome: "opened", document_id: documentId, document_model_ref: documentId, warnings: [] }),
    },
    write: { writeOutput: async () => { throw new Error("use_save_coordinator"); } },
    assets: { resolveFont: async () => null, resolveImage: async () => null, resolveAsset: async () => null },
    ipc: {
      call: (async (channel: string, body: unknown) => {
        if (channel === "host:slides-edit-transform") {
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
  capability: OfficeCapabilityEntry;
  readonly: boolean;
  documentId: string;
  open: (signal?: AbortSignal) => Promise<PptxOpenOutcome>;
}): ReactNode {
  const { t } = useTranslation();
  const { editor, coordinator, readonly, documentId, open, view, subscribe } = props;
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
      setFailure(outcome.message ?? outcome.failure_class ?? t("office.editor.open_error_hint"));
    }).catch((error: unknown) => {
      if (!active) return;
      setPhase("error");
      setFailure(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; controller.abort(); };
  }, [attempt, open, t]);

  const host = useMemo(() => makePptxEditorHost(editor, documentId), [documentId, editor]);

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
      }]);
    },
    [editor],
  );
  // The generic channel accepts the panel FormatEdit union too; once the engine
  // registers those kinds they are PptxEdit members and the cast is a no-op.
  const applyEdit = useCallback((edit: PptxEdit | FormatEdit) => editor.edit([edit as PptxEdit]), [editor]);
  const deleteElements = useCallback(
    (slideIndex: number, elementIds: readonly string[]) =>
      editor.edit(elementIds.map((elementId) => ({ op: "delete_element" as const, slideIndex, elementId }))),
    [editor],
  );
  // A real find: jump the editor to the first slide whose text carries the query.
  const find = useCallback((query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const index = deckSlideTexts(editor.deck()).findIndex((text) => text.toLowerCase().includes(needle));
    if (index >= 0) setSelected(index);
  }, [editor]);
  const commandCapabilities = useMemo(
    () => ({ "edit-text": readonly ? { status: "unavailable" as const, reason: t("office.editor.read_only_hint") } : ("available" as const) }),
    [readonly, t],
  );

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
      editorHandle={editor}
      slides={slides}
      deck={deck}
      selectedIndex={selected}
      onSlideSelect={setSelected}
      onCommitText={commitText}
      onTransform={transform}
      onApplyEdit={applyEdit}
      onDeleteElements={deleteElements}
      onFind={find}
      saveCoordinator={coordinator}
      capabilities={commandCapabilities}
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
    // still save) and republishing the deck view. A rejected replay is
    // swallowed: the shared void contract has no error channel to report it on.
    undo() {
      if (disposed || !modelRef) return;
      const ref = modelRef;
      void options.runtime.undo(ref).then((applied) => {
        if (!applied || disposed || modelRef !== ref) return;
        generation += 1;
        viewRevision += 1;
        session.coordinator.markDirty(generation);
        refreshView();
      }).catch(() => undefined);
    },
    redo() {
      if (disposed || !modelRef) return;
      const ref = modelRef;
      void options.runtime.redo(ref).then((applied) => {
        if (!applied || disposed || modelRef !== ref) return;
        generation += 1;
        viewRevision += 1;
        session.coordinator.markDirty(generation);
        refreshView();
      }).catch(() => undefined);
    },
    slides: () => (modelRef && !disposed ? options.runtime.slides(modelRef) : []),
    snapshot: () => (modelRef && !disposed ? options.runtime.snapshot(modelRef) : null),
    deck: () => (modelRef && !disposed ? options.runtime.deck(modelRef) : null),
    revision: () => viewRevision,
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
        capability={options.capability}
        readonly={options.readonly === true}
        documentId={options.identity.documentId}
        open={open.open}
      />
    ),
    open,
    onRecoverSnapshot,
  };
}
