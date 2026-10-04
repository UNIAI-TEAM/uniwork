"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { OfficeSaveCoordinatorLike } from "../office-shell";
import { buildSlideSvg, collectRenderNodeBoxes, type SlideSvgDocument } from "./canvas/build-slide-svg";
import { PptxCanvasSurface } from "./canvas/pptx-canvas-surface";
import { loadPptxRendererModule, type PptxRendererModule } from "./canvas/renderer-module";
import { usePptxDeckRenderer, usePptxPalette, usePptxRendererModule, useSlideRendition, type PptxDeckRendererInput } from "./canvas/use-canvas-host";
import { usePptxThumbnails } from "./canvas/use-pptx-thumbnails";
import { PPTX_FALLBACK_FIT_WIDTH, slideDisplaySize } from "./canvas/zoom";
import { createPptxCommandMap, type PptxCommandCapability, type PptxCommandId } from "./command-map";
import { PptxPresenter } from "./presenter";
import { PptxSelectionOverlay } from "./selection/pptx-selection-overlay";
import { usePptxSelection } from "./selection/use-pptx-selection";
import { PptxSlideRail, type PptxSlideView } from "./slide-rail";
import { PptxStatusBar } from "./status-bar";
import { PptxToolbar } from "./toolbar";
import { PptxFindBar } from "./toolbar/find-bar";

export interface PptxEditorProps {
  host: OfficeHost;
  editorHandle: EditorHandle | null;
  slides?: readonly PptxSlideView[];
  /** Opened deck model for the real rendition (UNI-927 P0-2). Without it the canvas
   *  reports that no render source is bound instead of inventing slide content. */
  deck?: PptxDeckRendererInput;
  /** Artifact loader seam; tests inject a fake module. */
  loadRendererModule?: () => Promise<PptxRendererModule>;
  selectedIndex?: number;
  onSlideSelect?: (index: number) => void;
  onTransform?: (request: SlidesEditTransformRequest) => Promise<unknown>;
  /** A real drag/resize request supplied by the host gesture surface. */
  transformRequest?: SlidesEditTransformRequest | null;
  /** Delete channel (P0-3). When absent the editor falls back to the handle's
   *  own `edit` port; when neither exists Delete stays honestly unbound. */
  onDeleteElements?: (slideIndex: number, elementIds: readonly string[]) => Promise<unknown>;
  onTextEdit?: (slideIndex: number) => Promise<unknown>;
  /** Find channel (C6). Absent leaves the find bar honest about being unbound. */
  onFind?: (query: string) => void;
  onOpen?: () => void;
  onCommandError?: (error: unknown) => void;
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onDirty?: () => void;
  onSnapshot?: () => Promise<unknown>;
  saveCoordinator?: OfficeSaveCoordinatorLike;
  capabilities?: Partial<Record<PptxCommandId, PptxCommandCapability | "available" | "readonly" | "unavailable" | "unknown">>;
  includeSave?: boolean;
  className?: string;
}

interface GestureState {
  promise: Promise<void>;
  resolve: () => void;
}

/** The web host's editor handle adds the typed edit channel to the shared
 * handle; the editor reads it structurally so a fake in a unit test can bind
 * Delete without implementing the whole web adapter. */
interface EditableHandle extends EditorHandle {
  edit?(edits: readonly PptxEdit[]): Promise<{ revision: number }>;
}

function makeGesture(): GestureState {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function isEditableHandle(handle: EditorHandle | null): handle is EditableHandle {
  return typeof (handle as EditableHandle | null)?.edit === "function";
}

/** PPTX renderer mounted by EditorSlot. It renders the current model supplied
 * by the host and never invents a blank deck after an open failure. */
export function PptxEditor({
  host,
  editorHandle,
  slides = [],
  deck,
  loadRendererModule = loadPptxRendererModule,
  selectedIndex: controlledIndex,
  onSlideSelect,
  onTransform,
  transformRequest = null,
  onDeleteElements,
  onTextEdit,
  onFind,
  onOpen,
  onCommandError,
  fullscreen = false,
  onFullscreenChange,
  onDirty,
  onSnapshot,
  saveCoordinator,
  capabilities,
  includeSave = true,
  className,
}: PptxEditorProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [internalIndex, setInternalIndex] = useState(0);
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [gesturePending, setGesturePending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitWidthPx, setFitWidthPx] = useState(PPTX_FALLBACK_FIT_WIDTH);
  const gestureRef = useRef<GestureState | null>(null);
  const historyQueue = useRef<"undo" | "redo" | null>(null);
  const presenterTriggerRef = useRef<HTMLElement | null>(null);
  const editorRootRef = useRef<HTMLElement | null>(null);
  const selectedIndex = Math.min(Math.max(controlledIndex ?? internalIndex, 0), Math.max(slides.length - 1, 0));
  const railIdPrefix = `pptx-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const palette = usePptxPalette();
  const rendererState = usePptxRendererModule(loadRendererModule, deck != null);
  const deckRenderer = usePptxDeckRenderer(rendererState, deck ?? {}, railIdPrefix, palette);
  const rendition = useSlideRendition(deckRenderer, selectedIndex, fitWidthPx);
  const patternGrid = rendererState.status === "ready" ? rendererState.module.patternGrid : undefined;
  const presetPath = rendererState.status === "ready" ? rendererState.module.presetPath : undefined;
  const presetPolygon = rendererState.status === "ready" ? rendererState.module.presetPolygon : undefined;
  // F10: an inline `imageSize` prop must not rebuild the whole SvgNode tree on every
  // parent render, so it is ref-stabilized the same way the deck renderer stabilizes
  // its own seam. A host that swaps the resolver mid-session bumps `deck.revision`.
  const imageSize = deck?.imageSize;
  const imageSizeRef = useRef(imageSize);
  useEffect(() => { imageSizeRef.current = imageSize; }, [imageSize]);
  const thumbnailRevision = deck?.revision;
  const svgBuild = useMemo<{ document: SlideSvgDocument | null; error: string | null }>(() => {
    if (!rendition) return { document: null, error: null };
    const resolveImageSize = imageSizeRef.current;
    try {
      return {
        document: buildSlideSvg(rendition, {
          idPrefix: railIdPrefix,
          palette,
          ...(resolveImageSize ? { imageSize: resolveImageSize } : {}),
          ...(patternGrid ? { patternGrid } : {}),
          ...(presetPath ? { presetPath } : {}),
          ...(presetPolygon ? { presetPolygon } : {}),
        }),
        error: null,
      };
    } catch (error) {
      // F18: a render tree that builds but cannot be converted to SVG must not crash
      // the editor surface; degrade to the same alert as a failed rendition build.
      return { document: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [palette, patternGrid, presetPath, presetPolygon, railIdPrefix, rendition]);
  const svgDocument = svgBuild.document;
  const deckBound = deck != null;
  const thumbnails = usePptxThumbnails({ renderer: deckRenderer, slides, ...(thumbnailRevision !== undefined ? { revision: thumbnailRevision } : {}) });
  const railSlides = useMemo<readonly PptxSlideView[]>(
    () => slides.map((slide) => ({ ...slide, thumbnailUrl: thumbnails.get(slide.id) ?? slide.thumbnailUrl })),
    [slides, thumbnails],
  );
  // P0-2 F6: the presenter used to upscale the 160px rail thumbnail fullscreen. Until
  // C2 owns a real presenter rendition, hand it the label only (no thumbnailUrl) so it
  // never shows a blurry 10x upscale.
  const presenterSlides = useMemo<readonly PptxSlideView[]>(
    () => slides.map((slide) => ({
      id: slide.id,
      ...(slide.label !== undefined ? { label: slide.label } : {}),
      ...(slide.hidden ? { hidden: true } : {}),
    })),
    [slides],
  );
  const effectiveCapabilities = useMemo(() => ({
    ...capabilities,
    open: onOpen
      ? capabilities?.open ?? { status: "available" as const }
      : { status: "unavailable" as const, reason: "Open is handled by the document shell" },
    "edit-text": onTextEdit
      ? capabilities?.["edit-text"] ?? { status: "available" as const }
      : { status: "unavailable" as const, reason: "Text editing is not bound to this editor surface" },
    "edit-shape-image": transformRequest
      ? capabilities?.["edit-shape-image"] ?? { status: "available" as const }
      : { status: "unavailable" as const, reason: "Select a real slide transform gesture to edit a shape or image" },
  }), [capabilities, onOpen, onTextEdit, transformRequest]);
  const commands = useMemo(() => createPptxCommandMap({ host, capabilities: effectiveCapabilities, includeSave: includeSave && Boolean(saveCoordinator), includePresentation: true }), [effectiveCapabilities, host, includeSave, saveCoordinator]);

  useEffect(() => {
    if (!editorHandle) return;
    return () => {
      void Promise.resolve().then(() => editorHandle.dispose()).catch(() => undefined);
    };
  }, [editorHandle]);

  useEffect(() => {
    if (selectedIndex >= slides.length && slides.length > 0) {
      setInternalIndex(slides.length - 1);
      onSlideSelect?.(slides.length - 1);
    }
  }, [onSlideSelect, selectedIndex, slides.length]);

  const selectSlide = useCallback((index: number) => {
    const bounded = Math.min(Math.max(index, 0), Math.max(slides.length - 1, 0));
    setInternalIndex(bounded);
    onSlideSelect?.(bounded);
  }, [onSlideSelect, slides.length]);

  const waitForGesture = useCallback(async () => {
    await gestureRef.current?.promise;
  }, []);

  const executeHistory = useCallback((kind: "undo" | "redo") => {
    if (kind === "undo") editorHandle?.undo?.();
    else editorHandle?.redo?.();
  }, [editorHandle]);

  const requestHistory = useCallback((kind: "undo" | "redo") => {
    if (gesturePending) {
      historyQueue.current = kind;
      return;
    }
    executeHistory(kind);
  }, [executeHistory, gesturePending]);

  const finishGesture = useCallback(() => {
    const current = gestureRef.current;
    gestureRef.current = null;
    setGesturePending(false);
    current?.resolve();
    const queued = historyQueue.current;
    historyQueue.current = null;
    if (queued) executeHistory(queued);
  }, [executeHistory]);

  const runTransform = useCallback(async (request: SlidesEditTransformRequest) => {
    if (gestureRef.current) await gestureRef.current.promise;
    const gesture = makeGesture();
    gestureRef.current = gesture;
    setGesturePending(true);
    setCommandError(null);
    try {
      const result = onTransform
        ? await onTransform(request)
        : await host.ipc.call("host:slides-edit-transform", request);
      onDirty?.();
      return result;
    } finally {
      finishGesture();
    }
  }, [finishGesture, host.ipc, onDirty, onTransform]);

  const runTextEdit = useCallback(async () => {
    await waitForGesture();
    if (!onTextEdit) return;
    setCommandError(null);
    await onTextEdit(selectedIndex);
    onDirty?.();
  }, [onDirty, onTextEdit, selectedIndex, waitForGesture]);

  const reportCommandError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setCommandError(message);
    onCommandError?.(error);
  }, [onCommandError]);

  const runCommand = useCallback((operation: Promise<unknown>) => {
    void operation.catch(reportCommandError);
  }, [reportCommandError]);

  const save = useCallback(() => {
    if (saveCoordinator) void saveCoordinator.save("button");
  }, [saveCoordinator]);

  const openPresenter = useCallback(() => {
    presenterTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPresenterOpen(true);
  }, []);

  const editableHandle = isEditableHandle(editorHandle) ? editorHandle : null;
  const deleteElements = useMemo(() => {
    if (onDeleteElements) return onDeleteElements;
    if (!editableHandle?.edit) return undefined;
    return async (slideIndex: number, elementIds: readonly string[]) => {
      await editableHandle.edit?.(elementIds.map((elementId) => ({ op: "delete_element", slideIndex, elementId })));
    };
  }, [editableHandle, onDeleteElements]);

  const selection = usePptxSelection({
    slideIndex: selectedIndex,
    boxes: rendition ? collectRenderNodeBoxes(rendition) : [],
    page: { widthPx: rendition?.widthPx ?? 0, heightPx: rendition?.heightPx ?? 0 },
    fitWidthPx,
    scale: zoom,
    interactive: Boolean(rendition) && !gesturePending,
    commitTransform: runTransform,
    ...(deleteElements ? { deleteElements } : {}),
    onError: reportCommandError,
    ...(onDirty ? { onDeleteCommitted: onDirty } : {}),
  });

  const displaySize = useMemo(() => {
    const aspect = rendition && rendition.widthPx > 0 ? rendition.heightPx / rendition.widthPx : 9 / 16;
    return slideDisplaySize(fitWidthPx, zoom, aspect);
  }, [fitWidthPx, rendition, zoom]);

  const onCommand = useCallback((id: PptxCommandId) => {
    switch (id) {
      case "edit-shape-image":
        if (transformRequest) runCommand(runTransform(transformRequest));
        break;
      case "edit-text": runCommand(runTextEdit()); break;
      case "open": onOpen?.(); break;
      case "undo": requestHistory("undo"); break;
      case "redo": requestHistory("redo"); break;
      case "save": save(); break;
      case "find": setFindOpen((open) => !open); break;
      case "presenter": openPresenter(); break;
      case "fullscreen": {
        if (onFullscreenChange) {
          onFullscreenChange(!fullscreen);
          break;
        }
        const request = editorRootRef.current?.requestFullscreen?.();
        if (request) void request.catch(reportCommandError);
        break;
      }
      default: break;
    }
  }, [fullscreen, onFullscreenChange, onOpen, openPresenter, reportCommandError, requestHistory, runCommand, runTextEdit, runTransform, save, transformRequest]);

  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    if (event.key === "PageDown" || event.key === "ArrowDown") { event.preventDefault(); selectSlide(selectedIndex + 1); }
    if (event.key === "PageUp" || event.key === "ArrowUp") { event.preventDefault(); selectSlide(selectedIndex - 1); }
    if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); requestHistory(event.shiftKey ? "redo" : "undo"); }
    if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); requestHistory("redo"); }
    if ((event.ctrlKey || event.metaKey) && key === "s") { event.preventDefault(); save(); }
    if ((event.ctrlKey || event.metaKey) && key === "f") { event.preventDefault(); setFindOpen(true); }
    if ((event.ctrlKey || event.metaKey) && key === "a") { event.preventDefault(); selection.selectAll(); }
    if (event.key === "Escape") { selection.clear(); }
    if ((event.key === "Delete" || event.key === "Backspace") && selection.canDelete) {
      event.preventDefault();
      selection.deleteSelection();
    }
  };

  const selectedCount = selection.selection.ids.length;

  return (
    <section ref={editorRootRef} className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-muted/10", className)} data-pptx-editor data-gesture-pending={gesturePending}>
      <PptxToolbar
        commands={commands}
        onCommand={onCommand}
        presenterOpen={presenterOpen}
        {...(editorHandle ? { canUndo: typeof editorHandle.undo === "function", canRedo: typeof editorHandle.redo === "function" } : { canUndo: false, canRedo: false })}
      />
      {findOpen ? (
        <PptxFindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          onClose={() => setFindOpen(false)}
          {...(onFind ? { onSearch: onFind } : {})}
        />
      ) : null}
      {commandError ? <Alert className="m-2" variant="destructive" role="alert"><AlertTitle>{t("command_error_title")}</AlertTitle><AlertDescription>{t("command_error_hint", { message: commandError })}</AlertDescription></Alert> : null}
      {rendererState.status === "error" ? (
        <Alert className="m-2" variant="destructive" role="alert" data-testid="pptx-render-error">
          <AlertTitle>{t("render_failed")}</AlertTitle>
          <AlertDescription>{t("render_failed_hint", { message: rendererState.message })}</AlertDescription>
        </Alert>
      ) : null}
      {svgBuild.error ? (
        <Alert className="m-2" variant="destructive" role="alert" data-testid="pptx-svg-error">
          <AlertTitle>{t("render_failed")}</AlertTitle>
          <AlertDescription>{t("render_failed_hint", { message: svgBuild.error })}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* C11: the slide rail stays on the LEFT. */}
        <PptxSlideRail slides={railSlides} selectedIndex={selectedIndex} onSelect={selectSlide} />
        <div className="flex min-h-48 min-w-0 flex-1 flex-col p-3">
          {/* C9: no floating command buttons over the slide. The only floating
              surface is the contextual selection overlay inside the slide box. */}
          <PptxCanvasSurface
            content={svgDocument ? { root: svgDocument.root, widthPx: svgDocument.widthPx, heightPx: svgDocument.heightPx, ...(rendition?.hidden ? { hidden: true } : {}) } : null}
            slideIndex={selectedIndex}
            slideCount={slides.length}
            building={deckBound && (rendererState.status === "loading" || (rendererState.status === "ready" && !rendition))}
            zoom={zoom}
            onFitWidthChange={setFitWidthPx}
            onKeyDown={onCanvasKeyDown}
            overlay={rendition ? (
              <PptxSelectionOverlay
                page={{ widthPx: rendition.widthPx, heightPx: rendition.heightPx }}
                displayWidthPx={displaySize.widthPx}
                displayHeightPx={displaySize.heightPx}
                controller={selection}
              />
            ) : null}
          />
        </div>
      </div>
      {/* C10: the status bar owns slide x/y, counts, language, selection and zoom. */}
      <PptxStatusBar
        slideCurrent={slides.length ? selectedIndex + 1 : null}
        slideTotal={slides.length || null}
        language={typeof document !== "undefined" ? document.documentElement.lang || null : null}
        selectionCount={selectedCount}
        gesturePending={gesturePending}
        zoom={zoom}
        onZoomChange={setZoom}
      />
      <PptxPresenter
        slides={presenterSlides}
        selectedIndex={selectedIndex}
        open={presenterOpen}
        onClose={() => {
          setPresenterOpen(false);
          presenterTriggerRef.current?.focus();
        }}
      />
      {onSnapshot ? <Button type="button" className="sr-only" onClick={() => void waitForGesture().then(onSnapshot)} data-testid="pptx-snapshot">{t("snapshot")}</Button> : null}
      {editorHandle == null && slides.length > 0 ? <Alert className="m-2" data-testid="pptx-editor-handle-warning"><AlertTitle>{t("session_missing")}</AlertTitle><AlertDescription>{t("session_missing_hint")}</AlertDescription></Alert> : null}
    </section>
  );
}