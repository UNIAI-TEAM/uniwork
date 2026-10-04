"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import type { FormatEdit, PptxEdit } from "@uniwork/office-engine/pptx";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { OfficeSaveCoordinatorLike } from "../office-shell";
import { buildSlideSvg, collectRenderNodeBoxes, type SlideSvgDocument } from "./canvas/build-slide-svg";
import { PptxCanvasSurface, type PptxCanvasContent } from "./canvas/pptx-canvas-surface";
import { loadPptxRendererModule, type PptxRendererModule } from "./canvas/renderer-module";
import { usePptxDeckRenderer, usePptxPalette, usePptxRendererModule, useSlideRendition, type PptxDeckRendererInput } from "./canvas/use-canvas-host";
import { usePptxThumbnails } from "./canvas/use-pptx-thumbnails";
import { PPTX_FALLBACK_FIT_WIDTH, slideDisplaySize } from "./canvas/zoom";
import { createPptxCommandMap, type PptxCommandCapability, type PptxCommandId } from "./command-map";
import { PptxContextMenu } from "./context-menu/pptx-context-menu";
import { buildPptxPanel, pptxContextualSelection, pptxPanelForTab, type PptxPanelData, type PptxPanelEdit, type PptxPanelKind } from "./pptx-panel-host";
import type { PptxTabId } from "./pptx-ribbon";
import { collectPptxPrintSlides, pptxPrintCapability, type PptxPrintPort } from "./print";
import type { PptxContextMenuAction } from "./context-menu/context-menu-model";
import { PptxPresenter } from "./presenter";
import { presenterNextSlideContent, presenterSlideContent } from "./show";
import { matchPptxShortcut } from "./shortcuts/pptx-shortcuts";
import { PptxShortcutsHelp } from "./shortcuts/pptx-shortcuts-help";
import { PptxSelectionOverlay } from "./selection/pptx-selection-overlay";
import { PptxTextEditLayer, PptxTextEditorOverlay, type PptxTextCommit } from "./text/pptx-text-editor";
import { collectTextTargets, type PptxTextTarget } from "./text/text-model";
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
  /** In-place text commit (A1ui). When bound, double-clicking a text element opens the
   *  contenteditable overlay; the commit carries the typed paragraphs for that element. */
  onCommitText?: (commit: PptxTextCommit) => Promise<unknown> | void;
  /** Find channel (C6). Absent leaves the find bar honest about being unbound. */
  onFind?: (query: string) => void;
  /** Speaker-notes read (NOTES-WIRE); absent keeps the honest empty-notes line. */
  slideNotes?: (slideIndex: number) => string | null;
  onOpen?: () => void;
  onCommandError?: (error: unknown) => void;
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onDirty?: () => void;
  onSnapshot?: () => Promise<unknown>;
  saveCoordinator?: OfficeSaveCoordinatorLike;
  capabilities?: Partial<Record<PptxCommandId, PptxCommandCapability | "available" | "readonly" | "unavailable" | "unknown">>;
  includeSave?: boolean;
  /** Wire-round seam: an already-composed side panel (ports bound by the shell). */
  panel?: ReactNode;
  /** Wire-round seam: render the active panel for this surface inside the editor. */
  panelKind?: PptxPanelKind;
  /** Wire-round seam: the deck data the notes/comments/headerfooter/media panels read. */
  panelData?: PptxPanelData;
  /** Wire-round seam: the committed print/PDF port (C1). Absent keeps export-pdf honestly disabled. */
  printPort?: PptxPrintPort | null;
  /** Wire-round seam: ONE generic edit channel every panel port routes to.
   *  Accepts the FormatEdit union too (an engine gap: it is not yet a PptxEdit
   *  kind). Falls back to the editor handle edit port when the host supplies none. */
  onApplyEdit?: (edit: PptxPanelEdit) => Promise<unknown>;
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
  onCommitText,
  onFind,
  slideNotes,
  onOpen,
  onCommandError,
  fullscreen = false,
  onFullscreenChange,
  onDirty,
  onSnapshot,
  saveCoordinator,
  capabilities,
  includeSave = true,
  panel,
  panelKind,
  panelData,
  printPort = null,
  onApplyEdit,
  className,
}: PptxEditorProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [internalIndex, setInternalIndex] = useState(0);
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  // WIRE-PANEL-TABS: the editor owns the active ribbon tab so the side panel can
  // be derived from it; the toolbar renders it as a controlled value.
  const [activeTab, setActiveTab] = useState<PptxTabId>("home");
  const [gesturePending, setGesturePending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [textTarget, setTextTarget] = useState<PptxTextTarget | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitWidthPx, setFitWidthPx] = useState(PPTX_FALLBACK_FIT_WIDTH);
  const gestureRef = useRef<GestureState | null>(null);
  const historyQueue = useRef<"undo" | "redo" | null>(null);
  const presenterTriggerRef = useRef<HTMLElement | null>(null);
  // F9: the Find trigger, so closing the find bar returns focus to it instead
  // of dropping the keyboard user to `document.body`.
  const findTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  // WIRE-CANVAS-BIND: the presenter shows the SAME rendition the canvas mounts, not the
  // 160px rail thumbnail (P0-2 F6). The next slide is built through the same renderer so
  // the preview is the real tree too.
  const presenterContent = useMemo<PptxCanvasContent | null>(() => presenterSlideContent(svgDocument, rendition?.hidden), [rendition?.hidden, svgDocument]);
  const presenterNext = useMemo<PptxCanvasContent | null>(
    // Built only while the presenter is open: the editor never pays for a
    // rendition nobody is looking at.
    () => (presenterOpen ? presenterNextSlideContent(deckRenderer, selectedIndex + 1, fitWidthPx, {
      idPrefix: `${railIdPrefix}-presenter`,
      palette,
      ...(imageSizeRef.current ? { imageSize: imageSizeRef.current } : {}),
      ...(patternGrid ? { patternGrid } : {}),
      ...(presetPath ? { presetPath } : {}),
      ...(presetPolygon ? { presetPolygon } : {}),
    }) : null),
    [deckRenderer, fitWidthPx, palette, patternGrid, presenterOpen, presetPath, presetPolygon, railIdPrefix, selectedIndex],
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
    // C1: the print/PDF command reports what the bound port can actually do.
    "export-pdf": capabilities?.["export-pdf"] ?? pptxPrintCapability(printPort),
  }), [capabilities, onOpen, onTextEdit, printPort, transformRequest]);
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

  const waitForGesture = useCallback(async () => { await gestureRef.current?.promise; }, []);

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

  const textTargets = useMemo(() => (rendition ? collectTextTargets(rendition) : []), [rendition]);
  const textTargetsRef = useRef(textTargets);
  useEffect(() => { textTargetsRef.current = textTargets; }, [textTargets]);

  // A1ui: the in-place editor is only mounted when the host bound the commit channel.
  const openTextEditor = useCallback((target: PptxTextTarget) => {
    if (!onCommitText) return;
    setCommandError(null);
    setTextTarget(target);
  }, [onCommitText]);

  // The ribbon Text command (and the editor's onTextEdit seam) opens the in-place editor
  // over the selected text element; with nothing selected it falls back to the seam.
  const openTextEditorForSelection = useCallback(() => {
    const target = selectionRef.current.ids.length
      ? textTargetsRef.current.find((candidate) => candidate.sourceId === selectionRef.current.ids[0])
      : undefined;
    if (target) { openTextEditor(target); return true; }
    return false;
  }, [openTextEditor]);

  const reportCommandError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setCommandError(message);
    onCommandError?.(error);
  }, [onCommandError]);

  const commitText = useCallback((commit: PptxTextCommit) => {
    setTextTarget(null);
    if (!onCommitText) return;
    void Promise.resolve(onCommitText(commit)).then(() => { onDirty?.(); }).catch(reportCommandError);
  }, [onCommitText, onDirty, reportCommandError]);

  const cancelTextEdit = useCallback(() => setTextTarget(null), []);

  const runCommand = useCallback((operation: Promise<unknown>) => {
    void operation.catch(reportCommandError);
  }, [reportCommandError]);
  /** A1ui: the ribbon Text command opens the in-place overlay when the selected element is
   *  a text element and the host bound the commit channel; otherwise it keeps the seam. */
  const runTextCommand = useCallback(() => {
    if (openTextEditorForSelection()) return;
    runCommand(runTextEdit());
  }, [openTextEditorForSelection, runCommand, runTextEdit]);

  const save = useCallback(() => { if (saveCoordinator) void saveCoordinator.save("button"); }, [saveCoordinator]);

  const openPresenter = useCallback(() => {
    presenterTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPresenterOpen(true);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    // F9: restore focus to the control that opened the bar.
    findTriggerRef.current?.focus();
  }, []);

  // Stable identity: an inline ref callback would detach/reattach on every
  // render and could clear the trigger between a close and its focus restore.
  const setFindTrigger = useCallback((element: HTMLButtonElement | null) => {
    findTriggerRef.current = element;
  }, []);

  const editableHandle = isEditableHandle(editorHandle) ? editorHandle : null;
  const deleteElements = useMemo(() => {
    if (onDeleteElements) return onDeleteElements;
    if (!editableHandle?.edit) return undefined;
    return async (slideIndex: number, elementIds: readonly string[]) => {
      await editableHandle.edit?.(elementIds.map((elementId) => ({ op: "delete_element", slideIndex, elementId })));
    };
  }, [editableHandle, onDeleteElements]);

  // A7: the z-order channel. `reorder_element` is a registered PptxEdit kind, so it
  // travels through the same handle edit port Delete uses; absent leaves the menu rows
  // disabled with their reason instead of a dead control.
  const reorderElements = useMemo(() => {
    if (!editableHandle?.edit) return undefined;
    return async (slideIndex: number, elementIds: readonly string[], dir: "front" | "back") => {
      await editableHandle.edit?.(elementIds.map((elementId) => ({ op: "reorder_element" as const, slideIndex, elementId, dir })));
    };
  }, [editableHandle]);

  // F3: the flattened node boxes feed both the selection hit-test and the R4
  // contextual tab flags, so a picture/shape/table selection is reachable.
  const nodeBoxes = useMemo(() => (rendition ? collectRenderNodeBoxes(rendition) : []), [rendition]);
  const selection = usePptxSelection({
    slideIndex: selectedIndex,
    boxes: nodeBoxes,
    page: { widthPx: rendition?.widthPx ?? 0, heightPx: rendition?.heightPx ?? 0 },
    fitWidthPx,
    scale: zoom,
    interactive: Boolean(rendition) && !gesturePending,
    commitTransform: runTransform,
    ...(deleteElements ? { deleteElements } : {}),
    onError: reportCommandError,
    ...(onDirty ? { onDeleteCommitted: onDirty } : {}),
  });
  // Latest selection for the ribbon Text command's ref, written after commit so the
  // handler never reads a stale id.
  const selectionRef = useRef(selection.selection);
  useEffect(() => { selectionRef.current = selection.selection; }, [selection.selection]);
  // F3: the R4 contextual tabs open only for the object actually selected; the
  // flags come from the live selection ids against the rendition node types.
  const contextual = useMemo(
    () => pptxContextualSelection(nodeBoxes, selection.selection.ids),
    [nodeBoxes, selection.selection.ids],
  );
  const displaySize = useMemo(() => {
    const aspect = rendition && rendition.widthPx > 0 ? rendition.heightPx / rendition.widthPx : 9 / 16;
    return slideDisplaySize(fitWidthPx, zoom, aspect);
  }, [fitWidthPx, rendition, zoom]);

  const onCommand = useCallback((id: PptxCommandId) => {
    switch (id) {
      case "edit-shape-image":
        if (transformRequest) runCommand(runTransform(transformRequest));
        break;
      case "edit-text": runTextCommand(); break;
      case "open": onOpen?.(); break;
      case "undo": requestHistory("undo"); break;
      case "redo": requestHistory("redo"); break;
      case "save": save(); break;
      case "find": setFindOpen((open) => !open); break;
      case "export-pdf":
        // C1: one committed print run through the bound port; nothing is faked
        // when the port is absent (the capability above keeps it disabled).
        if (printPort && deckRenderer) {
          runCommand(printPort.print({ slides: collectPptxPrintSlides(deckRenderer, { palette }) }));
        }
        break;
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
  }, [deckRenderer, fullscreen, onFullscreenChange, onOpen, openPresenter, palette, printPort, reportCommandError, requestHistory, runCommand, runTextCommand, runTransform, save, transformRequest]);

  // A7: one dispatch table owns the canvas keys. The chords live in the pure shortcut
  // map (which the help dialog also lists), so a key that runs is a key that is
  // documented and vice versa - there is no second, drifting handler.
  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const binding = matchPptxShortcut(event);
    if (!binding) return;
    switch (binding.action) {
      case "undo": event.preventDefault(); requestHistory("undo"); return;
      case "redo": event.preventDefault(); requestHistory("redo"); return;
      case "save": event.preventDefault(); save(); return;
      case "find": event.preventDefault(); setFindOpen(true); return;
      case "edit-text": event.preventDefault(); runCommand(runTextEdit()); return;
      case "select-all": event.preventDefault(); selection.selectAll(); return;
      case "delete-selection":
        if (selection.canDelete) {
          event.preventDefault();
          selection.deleteSelection();
        }
        return;
      case "next-slide": event.preventDefault(); selectSlide(selectedIndex + 1); return;
      case "previous-slide": event.preventDefault(); selectSlide(selectedIndex - 1); return;
      case "dismiss":
        // An open in-place text editor owns Escape first (A1ui); only then clear.
        if (textTarget) { setTextTarget(null); return; }
        selection.clear();
        return;
      case "shortcuts-help": event.preventDefault(); setShortcutsOpen(true); return;
      default: return;
    }
  };

  // A7: the canvas context menu's actions. Only a bound channel runs; the model
  // disables every other row with the reason the editor already knows.
  const onContextMenuAction = useCallback((action: PptxContextMenuAction) => {
    switch (action) {
      case "delete": selection.deleteSelection(); break;
      case "bring-to-front":
        if (reorderElements) runCommand(reorderElements(selectedIndex, selection.selection.ids, "front"));
        break;
      case "send-to-back":
        if (reorderElements) runCommand(reorderElements(selectedIndex, selection.selection.ids, "back"));
        break;
      case "edit-text": runCommand(runTextEdit()); break;
      default: break;
    }
  }, [reorderElements, runCommand, runTextEdit, selectedIndex, selection]);

  // Wire-round: compose the active panel (or the host-supplied one) through the
  // panel host; one generic edit channel, falling back to the handle edit port.
  // An explicit panel/panelKind is a host override; otherwise the active tab
  // decides the panel (pptxPanelForTab maps every panel-bearing tab, null for the rest).
  const derivedPanelKind = panelKind ?? pptxPanelForTab(activeTab);
  const activePanel = panel ?? buildPptxPanel({
    ...(derivedPanelKind ? { panelKind: derivedPanelKind } : {}),
    ...(onApplyEdit ? { onApplyEdit } : {}),
    ...(editableHandle?.edit ? { edit: (edits) => editableHandle.edit!(edits) } : {}),
    onError: reportCommandError,
    slideIndex: selectedIndex,
    slides,
    ...(panelData ? { data: panelData } : {}),
  });

  const selectedCount = selection.selection.ids.length;

  return (
    <section ref={editorRootRef} className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-muted/10", className)} data-pptx-editor data-gesture-pending={gesturePending}>
      <PptxToolbar
        commands={commands}
        onCommand={onCommand}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        presenterOpen={presenterOpen}
        findButtonRef={setFindTrigger}
        {...(contextual ? { contextual } : {})}
        {...(editorHandle ? { canUndo: typeof editorHandle.undo === "function", canRedo: typeof editorHandle.redo === "function" } : { canUndo: false, canRedo: false })}
      />
      {findOpen ? <PptxFindBar query={findQuery} onQueryChange={setFindQuery} onClose={closeFind} {...(onFind ? { onSearch: onFind } : {})} /> : null}
      {commandError ? <Alert className="m-2" variant="destructive" role="alert"><AlertTitle>{t("command_error_title")}</AlertTitle><AlertDescription>{t("command_error_hint", { message: commandError })}</AlertDescription></Alert> : null}
      {rendererState.status === "error" ? <Alert className="m-2" variant="destructive" role="alert" data-testid="pptx-render-error"><AlertTitle>{t("render_failed")}</AlertTitle><AlertDescription>{t("render_failed_hint", { message: rendererState.message })}</AlertDescription></Alert> : null}
      {svgBuild.error ? <Alert className="m-2" variant="destructive" role="alert" data-testid="pptx-svg-error"><AlertTitle>{t("render_failed")}</AlertTitle><AlertDescription>{t("render_failed_hint", { message: svgBuild.error })}</AlertDescription></Alert> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* C11: the slide rail stays on the LEFT. */}
        <PptxSlideRail slides={railSlides} selectedIndex={selectedIndex} onSelect={selectSlide} />
        <div className="flex min-h-48 min-w-0 flex-1 flex-col p-3">
          {/* C9: no floating command buttons over the slide. The only floating
              surface is the contextual selection overlay inside the slide box. */}
          <PptxContextMenu
            slideBound={slides.length > 0}
            selectionCount={selection.selection.ids.length}
            canDelete={Boolean(deleteElements)}
            canEditText={Boolean(onTextEdit)}
            canReorder={Boolean(reorderElements)}
            canInsert={false}
            gesturePending={gesturePending}
            onAction={onContextMenuAction}
          >
          <PptxCanvasSurface
            content={svgDocument ? { root: svgDocument.root, widthPx: svgDocument.widthPx, heightPx: svgDocument.heightPx, ...(rendition?.hidden ? { hidden: true } : {}) } : null}
            slideIndex={selectedIndex}
            slideCount={slides.length}
            building={deckBound && (rendererState.status === "loading" || (rendererState.status === "ready" && !rendition))} zoom={zoom} onFitWidthChange={setFitWidthPx} onKeyDown={onCanvasKeyDown}
            overlay={rendition ? (
              <>
                <PptxSelectionOverlay
                  page={{ widthPx: rendition.widthPx, heightPx: rendition.heightPx }}
                  displayWidthPx={displaySize.widthPx}
                  displayHeightPx={displaySize.heightPx}
                  controller={selection}
                />
                {/* A1ui: contextual in-place text editing inside the slide box (C9). */}
                {onCommitText ? (
                  <PptxTextEditLayer
                    slideIndex={selectedIndex}
                    targets={textTargets}
                    page={{ widthPx: rendition.widthPx, heightPx: rendition.heightPx }}
                    displayWidthPx={displaySize.widthPx}
                    displayHeightPx={displaySize.heightPx}
                    controller={selection}
                    activeId={textTarget?.sourceId ?? null}
                    onOpen={openTextEditor}
                  />
                ) : null}
                {onCommitText && textTarget ? (
                  <PptxTextEditorOverlay
                    slideIndex={selectedIndex}
                    target={textTarget}
                    page={{ widthPx: rendition.widthPx, heightPx: rendition.heightPx }}
                    displayWidthPx={displaySize.widthPx}
                    displayHeightPx={displaySize.heightPx}
                    onCommitText={commitText}
                    onCancel={cancelTextEdit}
                  />
                ) : null}
              </>
            ) : null}
          />
          </PptxContextMenu>
        </div>
        {activePanel}
      </div>
      {/* C10: the status bar owns slide x/y, counts, language, selection and zoom (no deck-language source yet, so the unknown mark). */}
      <PptxStatusBar slideCurrent={slides.length ? selectedIndex + 1 : null} slideTotal={slides.length || null} language={null} selectionCount={selectedCount} gesturePending={gesturePending} zoom={zoom} onZoomChange={setZoom} />
      <PptxShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <PptxPresenter slideCount={slides.length} selectedIndex={selectedIndex} content={presenterContent} nextContent={presenterNext} notes={deckBound ? (slideNotes ?? (editorHandle as { slideNotes?(index: number): string | null } | null)?.slideNotes?.bind(editorHandle))?.(selectedIndex) ?? null : null} building={deckBound && (rendererState.status === "loading" || (rendererState.status === "ready" && !rendition))} open={presenterOpen} onIndexChange={selectSlide} onClose={() => { setPresenterOpen(false); presenterTriggerRef.current?.focus(); }} />
      {onSnapshot ? <Button type="button" className="sr-only" onClick={() => void waitForGesture().then(onSnapshot)} data-testid="pptx-snapshot">{t("snapshot")}</Button> : null}
      {editorHandle == null && slides.length > 0 ? <Alert className="m-2" data-testid="pptx-editor-handle-warning"><AlertTitle>{t("session_missing")}</AlertTitle><AlertDescription>{t("session_missing_hint")}</AlertDescription></Alert> : null}
    </section>
  );
}
