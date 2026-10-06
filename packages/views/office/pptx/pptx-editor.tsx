"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { HeaderActionsFill } from "../../layout/header-actions-slot";
import { OfficeFrame } from "../frame/office-frame";
import type { OfficePrintPort } from "../print";
import type { OfficeSaveCoordinatorLike } from "../office-shell";
import { collectRenderNodeBoxes } from "./canvas/build-slide-svg";
import { PptxCanvasSurface } from "./canvas/pptx-canvas-surface";
import { loadPptxRendererModule, type PptxRendererModule } from "./canvas/renderer-module";
import type { PptxDeckRendererInput } from "./canvas/use-canvas-host";
import { usePptxThumbnails } from "./canvas/use-pptx-thumbnails";
import { PPTX_FALLBACK_FIT_WIDTH, slideDisplaySize } from "./canvas/zoom";
import { createPptxCommandMap, type PptxCommandCapability, type PptxCommandId } from "./command-map";
import { PptxContextMenu } from "./context-menu/pptx-context-menu";
import type { PptxContextMenuAction } from "./context-menu/context-menu-model";
import { pptxEditorCapabilities } from "./pptx-editor-capabilities";
import { pptxInsertElements } from "./insert/insert-elements";
import { pptxContextualSelection, readPptxPanelMotion, type PptxPanelData, type PptxPanelEdit, type PptxPanelKind } from "./pptx-panel-host";
import type { MasterElementView, MasterPartView } from "./masters";
import { usePptxEditorMasters, usePptxMasterCanvas } from "./pptx-masters-state";
import type { PptxTabId } from "./pptx-ribbon";
import { PptxFindReplacePanel, flattenDeckRuns, usePptxFindSelect, type PptxFindReplaceEdit } from "./find";
import { usePptxPrint } from "./print";
import { PptxPresenter } from "./presenter";
import { pptxShowGroupItems } from "./ribbon-show-items";
import { PptxSlideShow } from "./show/pptx-slide-show";
import { matchPptxShortcut } from "./shortcuts/pptx-shortcuts";
import { PptxShortcutsHelp } from "./shortcuts/pptx-shortcuts-help";
import { PptxSelectionOverlay } from "./selection/pptx-selection-overlay";
import { PptxTextEditLayer, PptxTextEditorOverlay, type PptxTextCommit } from "./text/pptx-text-editor";
import { collectTextTargets } from "./text/text-model";
import { usePptxSelection } from "./selection/use-pptx-selection";
import { PptxSlideRail, type PptxSlideView } from "./slide-rail";
import { PptxStatusBar, PptxStatusHelpButton } from "./status-bar";
import { PptxToolbar } from "./toolbar";
import { usePptxEditorRender } from "./use-pptx-editor-render";
import { usePptxFindShortcut } from "./use-pptx-find-shortcut";
import { usePptxMasterViewGate } from "./use-pptx-master-view-gate";
import { pptxTextCounts } from "./status-counts";
import { usePptxGestureHistory } from "./use-pptx-gesture-history";
import { usePptxInPlaceText } from "./use-pptx-in-place-text";
import { usePptxPanels } from "./use-pptx-panels";
import { usePptxPendingSelect } from "./use-pptx-pending-select";

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
  /** Speaker-notes read (NOTES-WIRE); absent keeps the honest empty-notes line. */
  slideNotes?: (slideIndex: number) => string | null;
  /** The deck's slide layouts for "New slide" (W4 F-03); absent (or the handle's
   *  own reader on desktop) leaves the sorter's honest no-layouts state. */
  slideLayouts?: () => readonly { name: string; path: string }[];
  /** Slide master read (B6): the deck master/layout parts. Absent leaves the masters panel unbound. */
  masterParts?: () => readonly MasterPartView[];
  /** Slide master read (B6): the elements of one master/layout part. */
  masterElements?: (partPath: string) => readonly MasterElementView[];
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
  /** The shared Office print port (UNI-952), bound by the host: the web browser port or the
   *  desktop host port. Absent/`null` hides Print and Export PDF instead of showing them dead. */
  printPort?: OfficePrintPort | null;
  /** Document title for the print job (the default PDF file name). */
  printTitle?: string;
  /** Wire-round seam: ONE generic edit channel every panel port routes to.
   *  Accepts the FormatEdit union too (an engine gap: it is not yet a PptxEdit
   *  kind). Falls back to the editor handle edit port when the host supplies none. */
  onApplyEdit?: (edit: PptxPanelEdit) => Promise<unknown>;
  className?: string;
}

/** The web host's editor handle adds the typed edit channel to the shared
 * handle; the editor reads it structurally so a fake in a unit test can bind
 * Delete without implementing the whole web adapter. */
interface EditableHandle extends EditorHandle {
  edit?(edits: readonly PptxEdit[]): Promise<{ revision: number }>;
  slideNotes?(slideIndex: number): string | null;
  slideLayouts?(): readonly { name: string; path: string }[];
}

/** Deck word/character counts; `_revision` only keys the memo. */
const deckTextCounts = (model: Parameters<typeof flattenDeckRuns>[0], _revision: unknown) => (model ? pptxTextCounts(flattenDeckRuns(model)) : null);

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
  slideNotes,
  slideLayouts,
  masterParts,
  masterElements,
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
  printPort: printPortProp,
  printTitle,
  onApplyEdit,
  className,
}: PptxEditorProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [internalIndex, setInternalIndex] = useState(0);
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // WIRE-PANEL-TABS: the editor owns the active ribbon tab (fixed or contextual)
  // so the side panel can be derived from it; the toolbar renders it controlled.
  const [activeTab, setActiveTab] = useState<string>("home");
  const [commandError, setCommandError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitWidthPx, setFitWidthPx] = useState(PPTX_FALLBACK_FIT_WIDTH);
  const presenterTriggerRef = useRef<HTMLElement | null>(null);
  // F9: the Find trigger, so closing the find bar returns focus to it instead
  // of dropping the keyboard user to `document.body`.
  const findTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editorRootRef = useRef<HTMLElement | null>(null);
  const selectedIndex = Math.min(Math.max(controlledIndex ?? internalIndex, 0), Math.max(slides.length - 1, 0));
  const clearCommandError = useCallback(() => setCommandError(null), []);
  const { gesturePending, waitForGesture, requestHistory, runTransform } = usePptxGestureHistory({
    host, editorHandle, ...(onTransform ? { onTransform } : {}), ...(onDirty ? { onDirty } : {}), onStart: clearCommandError, rootRef: editorRootRef,
    // W5 review F1: a modal surface over the editor owns the history chords.
    suspended: presenterOpen || showOpen || shortcutsOpen,
  });
  const railIdPrefix = `pptx-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const { palette, rendererState, deckRenderer, rendition, svgBuild, presenterContent, presenterNext, building } = usePptxEditorRender({
    deck, loadRendererModule, idPrefix: railIdPrefix, selectedIndex, fitWidthPx, presenterOpen,
  });
  const svgDocument = svgBuild.document;
  const deckBound = deck != null;
  const thumbnails = usePptxThumbnails({ renderer: deckRenderer, slides, ...(deck?.revision !== undefined ? { revision: deck.revision } : {}) });
  const railSlides = useMemo<readonly PptxSlideView[]>(
    () => slides.map((slide) => ({ ...slide, thumbnailUrl: thumbnails.get(slide.id) ?? slide.thumbnailUrl })),
    [slides, thumbnails],
  );
  const editableHandle = isEditableHandle(editorHandle) ? editorHandle : null;
  const handleEdit = useMemo(
    () => (editableHandle?.edit ? (edits: readonly PptxEdit[]) => editableHandle.edit!(edits) : undefined),
    [editableHandle],
  );

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

  const reportCommandError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setCommandError(message);
    onCommandError?.(error);
  }, [onCommandError]);
  const { textTarget, openTextEditor, closeTextEditor, commitText, flushTextEdit } = usePptxInPlaceText({
    rootRef: editorRootRef, ...(onCommitText ? { onCommitText } : {}), ...(onDirty ? { onDirty } : {}), onOpen: clearCommandError, onError: reportCommandError,
  });

  // The ribbon Text command (and the editor's onTextEdit seam) opens the in-place editor
  // over the selected text element; with nothing selected it falls back to the seam.
  const openTextEditorForSelection = useCallback(() => {
    const target = selectionRef.current.ids.length
      ? textTargetsRef.current.find((candidate) => candidate.sourceId === selectionRef.current.ids[0])
      : undefined;
    if (target) { openTextEditor(target); return true; }
    return false;
  }, [openTextEditor]);


  const runCommand = useCallback((operation: Promise<unknown>) => {
    void operation.catch(reportCommandError);
  }, [reportCommandError]);
  /** A1ui: the ribbon Text command opens the in-place overlay when the selected element is
   *  a text element and the host bound the commit channel; otherwise it keeps the seam. */
  const runTextCommand = useCallback(() => {
    if (openTextEditorForSelection()) return;
    runCommand(runTextEdit());
  }, [openTextEditorForSelection, runCommand, runTextEdit]);

  // W8 review F2: a save (or print) never serializes the deck without the text still
  // open in the in-place editor; the edit commits first, then the command runs.
  const save = useCallback(() => {
    if (!saveCoordinator) return;
    const commit = flushTextEdit();
    if (commit) void commit.then(() => saveCoordinator.save("button"));
    else void saveCoordinator.save("button");
  }, [flushTextEdit, saveCoordinator]);

  const openPresenter = useCallback(() => {
    void flushTextEdit();
    presenterTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPresenterOpen(true);
  }, [flushTextEdit]);

  // F-05: the audience show is opened from the click handler (a user gesture),
  // so the show's requestFullscreen is allowed.
  const startShow = useCallback((fromStart: boolean) => {
    // The commit starts synchronously; the show opens in this same user gesture.
    void flushTextEdit();
    if (fromStart) selectSlide(Math.max(slides.findIndex((slide) => slide.hidden !== true), 0));
    setShowOpen(true);
  }, [flushTextEdit, selectSlide, slides]);
  const showItems = useMemo(() => pptxShowGroupItems({
    canShow: slides.length > 0,
    onFromStart: () => startShow(true),
    onFromCurrent: () => startShow(false),
    onPresenterView: openPresenter,
  }), [openPresenter, slides.length, startShow]);

  const openFind = useCallback(() => setFindOpen(true), []);
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

  const deleteElements = useMemo(() => {
    if (onDeleteElements) return onDeleteElements;
    if (!handleEdit) return undefined;
    return async (slideIndex: number, elementIds: readonly string[]) => {
      await handleEdit(elementIds.map((elementId) => ({ op: "delete_element", slideIndex, elementId })));
    };
  }, [handleEdit, onDeleteElements]);

  // A7: the z-order channel. `reorder_element` is a registered PptxEdit kind, so it
  // travels through the same handle edit port Delete uses; absent leaves the menu rows
  // disabled with their reason instead of a dead control.
  const reorderElements = useMemo(() => {
    if (!handleEdit) return undefined;
    return async (slideIndex: number, elementIds: readonly string[], dir: "front" | "back") => {
      await handleEdit(elementIds.map((elementId) => ({ op: "reorder_element" as const, slideIndex, elementId, dir })));
    };
  }, [handleEdit]);

  // F3: the flattened node boxes feed both the selection hit-test and the R4
  // contextual tab flags, so a picture/shape/table/chart selection is reachable.
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
  const selectedIds = selection.selection.ids;
  // Latest selection for the ribbon Text command's ref, written after commit so the
  // handler never reads a stale id.
  const selectionRef = useRef(selection.selection);
  useEffect(() => { selectionRef.current = selection.selection; }, [selection.selection]);
  // F3: the R4 contextual tabs open only for the object actually selected; the
  // flags come from the live selection ids against the rendition node types.
  const contextual = useMemo(() => pptxContextualSelection(nodeBoxes, selectedIds), [nodeBoxes, selectedIds]);
  // Select-after-insert, scoped to the slide + revision it was requested on (W9 review F1).
  const onCreated = usePptxPendingSelect({
    slideIndex: selectedIndex, revision: deck?.revision, boxes: nodeBoxes, ready: Boolean(rendition) && !building, selectedIds, select: selection.select,
  });
  // R2-6: the find panel counts hits over the bound deck, one entry per run (the
  // engine's replace unit), and shows the active hit on the canvas. The deck model
  // mutates in place, so the revision is what refreshes the runs after an edit.
  const deckModel = deck?.deck;
  const deckRevision = deck?.revision;
  const findTexts = useMemo(() => {
    void deckRevision; // the model is mutated in place: only the revision says the runs moved
    return findOpen ? flattenDeckRuns(deckModel) : [];
  }, [deckModel, deckRevision, findOpen]);
  // T12: footer word/character counts; the revision re-runs it (the model mutates in place).
  const deckCounts = useMemo(() => deckTextCounts(deckModel, deckRevision), [deckModel, deckRevision]);
  const findReplace = useMemo(() => {
    if (onApplyEdit) return (edit: PptxFindReplaceEdit) => onApplyEdit(edit);
    if (handleEdit) return (edit: PptxFindReplaceEdit) => handleEdit([edit]);
    return undefined;
  }, [handleEdit, onApplyEdit]);
  const onFindHit = usePptxFindSelect({
    slideIndex: selectedIndex, selectSlide, boxes: nodeBoxes, ready: Boolean(rendition) && !building, select: selection.select,
  });
  // W5 review F11: "Edit text" only when the selection can actually be edited:
  // the host seam, or the in-place editor over a selected text element.
  const selectionHasText = selectedIds.length > 0 && textTargets.some((candidate) => candidate.sourceId === selectedIds[0]);
  const canEditText = Boolean(onTextEdit) || (Boolean(onCommitText) && selectionHasText);
  // UNI-952: one print run behind the ribbon and the header menu; a deck-less editor, or one
  // whose renderer has not loaded, has nothing to print, so every entry drops out.
  const { port: printPort, run: runPrint, notice: printNotice, menuItems: printMenuItems } = usePptxPrint({
    port: deckBound ? printPortProp : null, renderer: deckRenderer, slides, palette, ...(printTitle !== undefined ? { title: printTitle } : {}), flush: flushTextEdit, onFailed: reportCommandError,
  });
  const effectiveCapabilities = useMemo(() => pptxEditorCapabilities(capabilities, {
    open: Boolean(onOpen),
    textEdit: Boolean(onTextEdit),
    // X4fix F4: the in-place editor runs Text over a selected text element.
    commitText: Boolean(onCommitText),
    textSelected: selectionHasText,
    transform: Boolean(transformRequest),
    edit: Boolean(onApplyEdit ?? handleEdit),
    printPort,
  }), [capabilities, handleEdit, onApplyEdit, onCommitText, onOpen, onTextEdit, printPort, selectionHasText, transformRequest]);
  // B6: View > Slide master (open toggle, part/element reads, edits on the one channel).
  const masters = usePptxEditorMasters({ ...(masterParts ? { masterParts } : {}), ...(masterElements ? { masterElements } : {}), editorHandle, ...(onApplyEdit ? { onApplyEdit } : {}), ...(handleEdit ? { handleEdit } : {}), refreshKey: deck?.revision, onError: reportCommandError });
  const baseCommands = useMemo(() => createPptxCommandMap({ host, capabilities: effectiveCapabilities, includeSave: includeSave && Boolean(saveCoordinator), includePresentation: true }), [effectiveCapabilities, host, includeSave, saveCoordinator]);
  const toggleMasters = masters.toggle;
  // The open master view hides the deck: Ctrl+F is swallowed without opening Find (the gate below closes it).
  usePptxFindShortcut(editorRootRef, presenterOpen || showOpen || shortcutsOpen, openFind, masters.open);
  const displaySize = useMemo(() => {
    const aspect = rendition && rendition.widthPx > 0 ? rendition.heightPx / rendition.widthPx : 9 / 16;
    return slideDisplaySize(fitWidthPx, zoom, aspect);
  }, [fitWidthPx, rendition, zoom]);

  // NOTES-WIRE: the presenter and the notes panel read the same notes port (the
  // host prop, else the desktop handle's own reader).
  // The adapters' readers THROW (no_slide / notes_unbound), so every read is guarded.
  const notesReader = slideNotes ?? (editorHandle as EditableHandle | null)?.slideNotes?.bind(editorHandle);
  const notesBound = Boolean(notesReader);
  let currentNotes: string | null = null;
  try { currentNotes = deckBound && notesReader ? notesReader(selectedIndex) ?? null : null; } catch { currentNotes = null; }
  const layoutsReader = slideLayouts ?? (editorHandle as EditableHandle | null)?.slideLayouts?.bind(editorHandle);
  const loadLayouts = useMemo(() => (layoutsReader ? async () => layoutsReader() : undefined), [layoutsReader]);
  // X1: the transitions/animations panels read the live slide off the handle on
  // every render, so an edit, undo, redo or slide switch is reflected at once.
  const motion = deckBound ? readPptxPanelMotion(editorHandle, selectedIndex) : {};
  const motionKey = JSON.stringify(motion);
  // R4fix-connector: the Insert pickers list the current slide's top-level elements,
  // read from the rendition so they follow every revision and slide switch.
  const effectivePanelData = useMemo<PptxPanelData | undefined>(() => {
    const withNotes = notesBound && panelData?.notes === undefined ? { ...panelData, notes: currentNotes } : panelData;
    return { ...(JSON.parse(motionKey) as PptxPanelData), ...withNotes, ...(rendition && panelData?.insertElements === undefined ? { insertElements: pptxInsertElements(rendition) } : {}) };
  }, [currentNotes, motionKey, notesBound, panelData, rendition]);
  const reorderSelection = useCallback((dir: "front" | "back") => {
    if (reorderElements) runCommand(reorderElements(selectedIndex, selectionRef.current.ids, dir));
  }, [reorderElements, runCommand, selectedIndex]);
  // F-01: every built panel is reachable from a ribbon item, a launcher, a
  // panel command or the active (contextual) tab, bound to ONE edit channel.
  const panels = usePptxPanels({
    activeTab,
    contextual,
    ...(panelKind ? { panelKind } : {}),
    ...(panel ? { panel } : {}),
    ...(effectivePanelData ? { panelData: effectivePanelData } : {}),
    ...(onApplyEdit ? { applyEdit: onApplyEdit } : {}),
    ...(handleEdit ? { bulkEdit: handleEdit } : {}),
    onError: reportCommandError,
    slideIndex: selectedIndex,
    // R2-12: the sorter tiles show the same thumbnails as the rail.
    slides: railSlides,
    boxes: nodeBoxes,
    selectedIds,
    rendition,
    ...(reorderElements ? { reorder: reorderSelection } : {}),
    ...(selection.canDelete ? { remove: selection.deleteSelection } : {}),
    onSelectSlide: selectSlide,
    ...(loadLayouts ? { loadLayouts } : {}),
    showItems,
    onCreated,
    rootRef: editorRootRef,
  });
  const { openCommandPanel } = panels;
  // The open master view hides the deck slide, so slide-editing commands wait for Close master; Find and the sorter close.
  const commands = usePptxMasterViewGate({ open: masters.open, commands: baseCommands, clearSelection: selection.clear, find: { open: findOpen, close: () => setFindOpen(false) }, sorter: { open: panels.activeKind === "sorter", close: () => panels.openPanel("sorter") } });
  const onCommand = useCallback((id: PptxCommandId) => {
    if (openCommandPanel(id)) return;
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
      case "slideMaster": toggleMasters(); break;
      case "export-pdf":
      case "print":
        // C1/UNI-952: the same run as the header menu item; hidden without a port.
        runPrint();
        break;
      // The tab-row Present control starts the audience show from the current
      // slide; the presenter console is the Slide Show tab's Presenter View.
      case "presenter": startShow(false); break;
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
  }, [fullscreen, onFullscreenChange, onOpen, openCommandPanel, reportCommandError, runPrint, requestHistory, runCommand, runTextCommand, runTransform, save, startShow, toggleMasters, transformRequest]);

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
        if (textTarget) { closeTextEditor(); return; }
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
      case "bring-to-front": reorderSelection("front"); break;
      case "send-to-back": reorderSelection("back"); break;
      // F-14: the in-place editor over the selection, falling back to the seam.
      case "edit-text": runTextCommand(); break;
      // F-14: Insert opens the Insert tab, whose default surface is the insert panel.
      case "insert": setActiveTab("insert"); break;
      default: break;
    }
  }, [reorderSelection, runTextCommand, selection]);

  const alerts = [
    printNotice,
    commandError ? <Alert key="cmd" className="rounded-none border-x-0 border-t-0" variant="destructive" role="alert"><AlertTitle>{t("command_error_title")}</AlertTitle><AlertDescription>{t("command_error_hint", { message: commandError })}</AlertDescription></Alert> : null,
    rendererState.status === "error" ? <Alert key="render" className="rounded-none border-x-0 border-t-0" variant="destructive" role="alert" data-testid="pptx-render-error"><AlertTitle>{t("render_failed")}</AlertTitle><AlertDescription>{t("render_failed_hint", { message: rendererState.message })}</AlertDescription></Alert> : null,
    svgBuild.error ? <Alert key="svg" className="rounded-none border-x-0 border-t-0" variant="destructive" role="alert" data-testid="pptx-svg-error"><AlertTitle>{t("render_failed")}</AlertTitle><AlertDescription>{t("render_failed_hint", { message: svgBuild.error })}</AlertDescription></Alert> : null,
    editorHandle == null && slides.length > 0 ? <Alert key="handle" className="rounded-none border-x-0 border-t-0" data-testid="pptx-editor-handle-warning"><AlertTitle>{t("session_missing")}</AlertTitle><AlertDescription>{t("session_missing_hint")}</AlertDescription></Alert> : null,
  ];
  const page = rendition ? { widthPx: rendition.widthPx, heightPx: rendition.heightPx } : null;
  // Visual fix MAJOR-2: the open master view owns the canvas (read-only part preview); Close brings the deck back.
  const masterCanvas = usePptxMasterCanvas(masters, page);

  return (
    <section ref={editorRootRef} className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)} data-pptx-editor data-gesture-pending={gesturePending}>
      {printMenuItems ? <HeaderActionsFill menuItems={printMenuItems} /> : null}
      <OfficeFrame
        ribbon={
          <PptxToolbar
            commands={commands}
            onCommand={onCommand}
            activeTab={activeTab as PptxTabId}
            onActiveTabChange={setActiveTab}
            presenterOpen={showOpen}
            findButtonRef={setFindTrigger}
            activePanel={panels.activeKind}
            onOpenPanel={panels.openPanel}
            panelDisabled={panels.panelDisabled}
            groupItems={panels.groupItems}
            pressedCommands={masters.pressed} masterView={masters.open}
            {...(contextual ? { contextual } : {})}
            {...(editorHandle ? { canUndo: typeof editorHandle.undo === "function", canRedo: typeof editorHandle.redo === "function" } : { canUndo: false, canRedo: false })}
          />
        }
        subbar={<>
          {findOpen ? <PptxFindReplacePanel texts={findTexts} onActiveHitChange={onFindHit} onClose={closeFind} onError={reportCommandError} readonly={!findReplace} {...(findReplace ? { onFindReplace: findReplace } : {})} /> : null}
          {alerts}
        </>}
        rail={<PptxSlideRail slides={railSlides} selectedIndex={selectedIndex} onSelect={selectSlide} />}
        bottom={!masters.open && panels.placement === "bottom" ? panels.node : undefined}
        aside={masters.aside ?? (panels.placement === "aside" ? panels.node : undefined)}
        statusBar={
          /* C10: the status bar owns slide x/y, counts, language, selection and zoom (no deck-language source yet, so the unknown mark). */
          <PptxStatusBar slideCurrent={slides.length ? selectedIndex + 1 : null} slideTotal={slides.length || null} language={null} selectionCount={selectedIds.length} gesturePending={gesturePending} zoom={zoom} onZoomChange={setZoom} help={<PptxStatusHelpButton onOpen={() => setShortcutsOpen(true)} />} counts={deckCounts} notesOpen={panels.activeKind === "notes"} onToggleNotes={() => panels.openPanel("notes")} view={panels.activeKind === "sorter" ? "sorter" : "normal"} onViewChange={(next) => { if ((next === "sorter") !== (panels.activeKind === "sorter")) panels.openPanel("sorter"); }} onSlideShow={() => startShow(false)} />
        }
      >
        <div className="flex h-full min-h-48 min-w-0 flex-col">
          {/* C9: no floating command buttons over the slide. The only floating
              surface is the contextual selection overlay inside the slide box. */}
          <PptxContextMenu
            slideBound={slides.length > 0}
            selectionCount={selectedIds.length}
            canDelete={Boolean(deleteElements)} canEditText={canEditText}
            canReorder={Boolean(reorderElements)} canInsert={Boolean(onApplyEdit ?? handleEdit)}
            gesturePending={gesturePending} masterView={masterCanvas !== null}
            onAction={onContextMenuAction}
          >
            <PptxCanvasSurface
              content={masterCanvas ? masterCanvas.content : svgDocument ? { root: svgDocument.root, widthPx: svgDocument.widthPx, heightPx: svgDocument.heightPx, ...(rendition?.hidden ? { hidden: true } : {}) } : null}
              slideIndex={selectedIndex}
              slideCount={slides.length}
              building={building}
              zoom={zoom}
              onFitWidthChange={setFitWidthPx}
              onKeyDown={masterCanvas ? undefined : onCanvasKeyDown}
              overlay={masterCanvas ? masterCanvas.overlay : page ? (
                <>
                  <PptxSelectionOverlay page={page} displayWidthPx={displaySize.widthPx} displayHeightPx={displaySize.heightPx} controller={selection} />
                  {/* A1ui: contextual in-place text editing inside the slide box (C9). */}
                  {onCommitText ? (
                    <PptxTextEditLayer slideIndex={selectedIndex} targets={textTargets} page={page} displayWidthPx={displaySize.widthPx} displayHeightPx={displaySize.heightPx} controller={selection} activeId={textTarget?.sourceId ?? null} onOpen={openTextEditor} />
                  ) : null}
                  {onCommitText && textTarget ? (
                    <PptxTextEditorOverlay slideIndex={selectedIndex} target={textTarget} page={page} displayWidthPx={displaySize.widthPx} displayHeightPx={displaySize.heightPx} onCommitText={commitText} onCancel={closeTextEditor} />
                  ) : null}
                </>
              ) : null}
            />
          </PptxContextMenu>
        </div>
      </OfficeFrame>
      <PptxShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <PptxPresenter slideCount={slides.length} selectedIndex={selectedIndex} content={presenterContent} nextContent={presenterNext} notes={currentNotes} building={building} open={presenterOpen} onIndexChange={selectSlide} onClose={() => { setPresenterOpen(false); presenterTriggerRef.current?.focus(); }} />
      {showOpen ? <PptxSlideShow slideCount={slides.length} index={selectedIndex} onIndexChange={selectSlide} onExit={() => setShowOpen(false)} content={presenterContent} hidden={slides.map((slide) => slide.hidden === true)} building={building} /> : null}
      {onSnapshot ? <Button type="button" className="sr-only" onClick={() => void waitForGesture().then(onSnapshot)} data-testid="pptx-snapshot">{t("snapshot")}</Button> : null}
    </section>
  );
}
