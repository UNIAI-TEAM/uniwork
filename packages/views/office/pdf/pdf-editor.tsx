"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the editor landmark owns keyboard shortcuts */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { PdfErrorState } from "./pdf-error-state";
import { PdfPasswordPrompt, type PdfPasswordMode } from "./password";
import { PdfRibbonBar, PdfStatusBar } from "./chrome";
import { PdfEditorSurface, type PdfSurfacePanelId } from "./pdf-editor-surface";
import { pdfEditErrorKey } from "./pdf-edit-error";
import { PDF_MAX_ZOOM, PDF_MIN_ZOOM, clampPdfZoom, fitPdfZoom } from "./fit-zoom";
import { PDF_COMMANDS, PDF_BROWSER_UNSUPPORTED_REASON_KEY, PDF_COMMAND_CAPABILITIES, pdfCommandDisabledReason, type PdfCommandId } from "./pdf-command-map";
import type { PdfToolbarCommand, PdfToolbarTab } from "./toolbar";
import type { PdfEditorProps, PdfOpenFailure, PdfOpenOutcome, PdfPage, PdfSelection, PdfSnapshot, PdfViewState } from "./types";

function unexpectedFailure(documentId: string, error: unknown): PdfOpenFailure {
  if (error instanceof EngineBoundaryError) {
    return { outcome: "failed", document_id: documentId, format: "pdf", failure_class: "engine_error", engine_error: error.code };
  }
  return { outcome: "failed", document_id: documentId, format: "pdf", failure_class: "engine_error" };
}

function isFailure(outcome: PdfOpenOutcome): outcome is PdfOpenFailure {
  return outcome.outcome === "failed";
}

function passwordMode(failure: PdfOpenFailure): PdfPasswordMode | null {
  if (failure.failure_class === "password_required") return "required";
  if (failure.failure_class === "wrong_password") return "wrong";
  return null;
}

const DEFAULT_PAGE: PdfPage = { pageNumber: 1, rotation: 0 };

/** Which panel each ribbon command opens. Commands with no panel (save, undo,
 * redo, rotate) and panels without a command id (signatures, page size,
 * properties, drawings, ink) are not listed. Highlight, note, stamp and forms
 * live on the Annotate tab; delete and reorder open the page strip. */
const PANEL_FOR_COMMAND: Readonly<Partial<Record<PdfCommandId, PdfSurfacePanelId>>> = {
  [PDF_COMMANDS.editText]: "text",
  [PDF_COMMANDS.replaceImage]: "image",
  [PDF_COMMANDS.annotations]: "markups",
  [PDF_COMMANDS.highlight]: "markups",
  [PDF_COMMANDS.note]: "notes",
  [PDF_COMMANDS.stamp]: "stamps",
  [PDF_COMMANDS.forms]: "forms",
  [PDF_COMMANDS.insertPage]: "page-ops",
  [PDF_COMMANDS.deletePage]: "pages",
  [PDF_COMMANDS.reorderPage]: "pages",
  [PDF_COMMANDS.extractPage]: "page-ops",
  [PDF_COMMANDS.mergePages]: "page-ops",
};

/** The capability row each command id is gated on. `PDF_COMMAND_CAPABILITIES`
 * is keyed by the command's name (`editText`), while a command's id is its
 * value (`edit-text`), so this bridges the two once instead of at every lookup. */
const CAPABILITY_FOR_COMMAND: Readonly<Record<PdfCommandId, string>> = {
  [PDF_COMMANDS.undo]: PDF_COMMAND_CAPABILITIES.undo,
  [PDF_COMMANDS.redo]: PDF_COMMAND_CAPABILITIES.redo,
  [PDF_COMMANDS.editText]: PDF_COMMAND_CAPABILITIES.editText,
  [PDF_COMMANDS.replaceImage]: PDF_COMMAND_CAPABILITIES.replaceImage,
  [PDF_COMMANDS.insertPage]: PDF_COMMAND_CAPABILITIES.insertPage,
  [PDF_COMMANDS.deletePage]: PDF_COMMAND_CAPABILITIES.deletePage,
  [PDF_COMMANDS.rotatePage]: PDF_COMMAND_CAPABILITIES.rotatePage,
  [PDF_COMMANDS.reorderPage]: PDF_COMMAND_CAPABILITIES.reorderPage,
  [PDF_COMMANDS.extractPage]: PDF_COMMAND_CAPABILITIES.extractPage,
  [PDF_COMMANDS.mergePages]: PDF_COMMAND_CAPABILITIES.mergePages,
  [PDF_COMMANDS.annotations]: PDF_COMMAND_CAPABILITIES.annotations,
  [PDF_COMMANDS.highlight]: PDF_COMMAND_CAPABILITIES.highlight,
  [PDF_COMMANDS.note]: PDF_COMMAND_CAPABILITIES.note,
  [PDF_COMMANDS.stamp]: PDF_COMMAND_CAPABILITIES.stamp,
  [PDF_COMMANDS.forms]: PDF_COMMAND_CAPABILITIES.forms,
  [PDF_COMMANDS.save]: PDF_COMMAND_CAPABILITIES.save,
  [PDF_COMMANDS.zoomOut]: PDF_COMMAND_CAPABILITIES.zoomOut,
  [PDF_COMMANDS.zoomIn]: PDF_COMMAND_CAPABILITIES.zoomIn,
  [PDF_COMMANDS.fitWidth]: PDF_COMMAND_CAPABILITIES.fitWidth,
  [PDF_COMMANDS.fitPage]: PDF_COMMAND_CAPABILITIES.fitPage,
};

/** Every command the ribbon may render, in the catalogue's stable order. */
const COMMAND_ORDER: readonly PdfCommandId[] = [
  PDF_COMMANDS.save,
  PDF_COMMANDS.undo,
  PDF_COMMANDS.redo,
  PDF_COMMANDS.editText,
  PDF_COMMANDS.replaceImage,
  PDF_COMMANDS.annotations,
  PDF_COMMANDS.highlight,
  PDF_COMMANDS.note,
  PDF_COMMANDS.stamp,
  PDF_COMMANDS.forms,
  PDF_COMMANDS.insertPage,
  PDF_COMMANDS.deletePage,
  PDF_COMMANDS.rotatePage,
  PDF_COMMANDS.reorderPage,
  PDF_COMMANDS.extractPage,
  PDF_COMMANDS.mergePages,
  PDF_COMMANDS.zoomOut,
  PDF_COMMANDS.zoomIn,
  PDF_COMMANDS.fitWidth,
  PDF_COMMANDS.fitPage,
];

const ZOOM_STEP = 0.1;

/** Controls that own a native undo stack; the document shortcut must leave their Ctrl+Z / Ctrl+Y alone. */
function isEditableTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  const editable = target.closest("[contenteditable], [role='textbox']");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

export function PdfEditor<TSnapshot = PdfSnapshot>({ documentKey, editor, open, coordinator, capability, title, className, onOpen, onSelectionChange }: PdfEditorProps<TSnapshot>) {
  const { t } = useTranslation();
  const [viewState, setViewState] = useState<PdfViewState>("opening");
  const [failure, setFailure] = useState<PdfOpenFailure | null>(null);
  const [snapshot, setSnapshot] = useState<PdfSnapshot | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [fontReport, setFontReport] = useState(() => editor.getFontReport?.() ?? null);
  const [retryToken, setRetryToken] = useState(0);
  const [passwordPending, setPasswordPending] = useState(false);
  const [activePanel, setActivePanel] = useState<PdfSurfacePanelId | null>(null);
  const [activeTab, setActiveTab] = useState<PdfToolbarTab>("home");
  const [findOpen, setFindOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editErrorKey, setEditErrorKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [railOpen, setRailOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initialFitDoneRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const passwordControllerRef = useRef<AbortController | null>(null);
  const editorRef = useRef(editor);
  const openRef = useRef(open);
  const coordinatorRef = useRef(coordinator);
  const capabilityRef = useRef(capability);
  const onOpenRef = useRef(onOpen);
  const translateRef = useRef(t);
  const queueRef = useRef<Promise<unknown> | null>(null);
  editorRef.current = editor;
  openRef.current = open;
  coordinatorRef.current = coordinator;
  capabilityRef.current = capability;
  onOpenRef.current = onOpen;
  translateRef.current = t;

  const capabilityStatus = capability?.status;
  const capabilityOperation = capability?.operation;
  const readOnly = capability?.operation !== "serialize" || capability.status !== "available";
  const effectiveTitle = title ?? t("office.pdf.title");
  const pages = snapshot?.pages ?? [];
  const selectedPage = selection?.page ?? pages[0]?.pageNumber ?? null;

  useEffect(() => {
    const port = editor.selection;
    if (!port) {
      setSelection(null);
      onSelectionChange?.(null);
      return undefined;
    }
    const emit = (next: PdfSelection | null) => {
      setSelection(next);
      onSelectionChange?.(next);
    };
    emit(port.getSelection());
    return port.subscribe?.(emit);
  }, [editor, documentKey, onSelectionChange]);

  useEffect(() => {
    const activeEditor = editorRef.current;
    const activeOpen = openRef.current;
    const activeCoordinator = coordinatorRef.current;
    const activeCapability = capabilityRef.current;
    const activeOnOpen = onOpenRef.current;
    const translate = translateRef.current;
    const controller = new AbortController();
    disposedRef.current = false;
    setViewState("opening");
    setFailure(null);
    setPasswordPending(false);
    setEditErrorKey(null);
    setSnapshot(null);
    setFontReport(activeEditor.getFontReport?.() ?? null);

    const run = async () => {
      if (!activeCapability || (activeCapability.operation !== "open" && activeCapability.operation !== "serialize") || activeCapability.status === "unavailable" || activeCapability.status === "unknown") {
        const blocked: PdfOpenFailure = { outcome: "failed", document_id: documentKey, format: "pdf", failure_class: "unsupported_feature", message: activeCapability?.reason ?? translate("office.pdf.errors.capabilityUnavailable") };
        setFailure(blocked);
        setViewState("error");
        activeOnOpen?.(blocked);
        return;
      }
      try {
        const outcome = await activeOpen.open(controller.signal);
        if (controller.signal.aborted || disposedRef.current) return;
        activeOnOpen?.(outcome);
        if (isFailure(outcome)) {
          setFailure(outcome);
          setViewState("error");
          return;
        }
        await activeEditor.open();
        if (controller.signal.aborted || disposedRef.current) return;
        const nextSnapshot = activeEditor.getPdfSnapshot?.() ?? { pages: [DEFAULT_PAGE], pageCount: 1 };
        setSnapshot(nextSnapshot);
        setFontReport(activeEditor.getFontReport?.() ?? null);
        setViewState("ready");
      } catch (error) {
        if (controller.signal.aborted || disposedRef.current) return;
        const next = unexpectedFailure(documentKey, error);
        setFailure(next);
        setViewState("error");
        activeOnOpen?.(next);
      }
    };
    void run();
    return () => {
      disposedRef.current = true;
      controller.abort();
      passwordControllerRef.current?.abort();
      passwordControllerRef.current = null;
      void activeEditor.cancel?.("document_changed");
      void activeCoordinator.cancel?.();
      void activeEditor.dispose();
    };
  }, [documentKey, retryToken, capabilityOperation, capabilityStatus]);

  useEffect(() => {
    if (viewState !== "ready") return undefined;
    const apply = () => {
      if (initialFitDoneRef.current === documentKey) return;
      const pane = canvasRef.current;
      const page = editorRef.current.getCanvasPages?.()?.[0];
      if (!pane || !page || pane.clientWidth <= 0) return;
      const fitted = fitPdfZoom("fit-width", { width: pane.clientWidth, height: pane.clientHeight }, page);
      if (fitted !== null && fitted < 1) setZoom(fitted);
      initialFitDoneRef.current = documentKey;
    };
    apply();
    // The pane is zero-sized at the first paint; a resize is the first chance
    // to measure it in a real host (and the only signal jsdom offers).
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [documentKey, viewState]);

  // The key handler lives on the editor landmark, so a shortcut pressed right
  // after load (focus still on body) would reach the browser instead: take focus
  // once the document is ready unless something else already holds it.
  useEffect(() => {
    if (viewState !== "ready") return;
    const active = document.activeElement;
    if (!active || active === document.body) rootRef.current?.focus({ preventScroll: true });
  }, [documentKey, viewState]);

  const submitPassword = useCallback(async (password: string) => {
    const activeOpen = openRef.current;
    const activeEditor = editorRef.current;
    const activeOnOpen = onOpenRef.current;
    const controller = new AbortController();
    passwordControllerRef.current = controller;
    setPasswordPending(true);
    try {
      const outcome = await activeOpen.open(controller.signal, password);
      if (disposedRef.current) return;
      activeOnOpen?.(outcome);
      if (isFailure(outcome)) {
        setFailure(outcome);
        setViewState("error");
        return;
      }
      await activeEditor.open();
      if (disposedRef.current) return;
      setFailure(null);
      setSnapshot(activeEditor.getPdfSnapshot?.() ?? { pages: [DEFAULT_PAGE], pageCount: 1 });
      setFontReport(activeEditor.getFontReport?.() ?? null);
      setViewState("ready");
    } catch (error) {
      if (disposedRef.current) return;
      const next = unexpectedFailure(documentKey, error);
      setFailure(next);
      setViewState("error");
      activeOnOpen?.(next);
    } finally {
      if (passwordControllerRef.current === controller) passwordControllerRef.current = null;
      if (!disposedRef.current) setPasswordPending(false);
    }
  }, [documentKey]);

  const cancelPassword = useCallback(() => {
    const next: PdfOpenFailure = { outcome: "failed", document_id: documentKey, format: "pdf", failure_class: "password_cancelled" };
    setFailure(next);
    setViewState("error");
    onOpenRef.current?.(next);
  }, [documentKey]);

  const refreshSnapshot = useCallback(() => {
    const next = editor.getPdfSnapshot?.();
    if (next) setSnapshot(next);
    setFontReport(editor.getFontReport?.() ?? null);
  }, [editor]);

  const markDirty = useCallback(() => {
    coordinator.markDirty?.(editor.getDirtyGeneration());
    refreshSnapshot();
    setRevision((value) => value + 1);
  }, [coordinator, editor, refreshSnapshot]);

  // A host that reports byte changes itself (async undo/redo) refreshes the view
  // and re-marks dirty with the generation the swap produced. undo/redo mark
  // synchronously, before the adapter's queued byte swap bumps the generation, so
  // without this the coordinator still holds the pre-step generation and refuses
  // Save with `invalid_snapshot`. markDirty is Math.max-monotonic, so re-marking
  // on every notify is safe for the edit path too.
  useEffect(() => editor.subscribe?.(() => {
    coordinator.markDirty?.(editor.getDirtyGeneration());
    refreshSnapshot();
    setRevision((value) => value + 1);
  }), [coordinator, editor, refreshSnapshot]);

  /** One document change at a time, in order: two quick edits must not both start from the same bytes.
   * An idle queue starts the action synchronously. */
  const runEdit = useCallback(<T,>(action: () => Promise<T> | T): Promise<T> => {
    if (readOnly) return Promise.reject(new Error("pdf_read_only"));
    setEditErrorKey(null);
    const execute = async (): Promise<T> => {
      try {
        const value = await action();
        markDirty();
        return value;
      } catch (error) {
        if (!disposedRef.current) setEditErrorKey(pdfEditErrorKey(error));
        throw error;
      }
    };
    const previous = queueRef.current;
    const result = previous ? previous.catch(() => undefined).then(execute) : execute();
    queueRef.current = result;
    const release = () => { if (queueRef.current === result) queueRef.current = null; };
    result.then(release, release);
    return result;
  }, [markDirty, readOnly]);

  const rotateSelected = useCallback(() => {
    if (!editor.edit || selectedPage === null) return;
    const edit = editor.edit;
    const page = selectedPage;
    runEdit(async () => { await edit([{ op: "rotate_page", target: { page }, degrees: 90 }]); }).catch(() => undefined);
  }, [editor, runEdit, selectedPage]);

  const selectPage = useCallback((next: PdfSelection) => {
    setSelection(next);
    editor.selection?.setSelection?.(next);
    onSelectionChange?.(next);
  }, [editor.selection, onSelectionChange]);
  const selectPageNumber = useCallback((page: number) => selectPage({ page, objectId: null, kind: "page" }), [selectPage]);

  const save = useCallback((entryPoint: "button" | "shortcut" = "button") => {
    if (viewState !== "ready" || readOnly) return;
    void coordinator.save(entryPoint);
  }, [coordinator, readOnly, viewState]);

  // Ctrl+Z/Y and the ribbon's undo/redo only mark dirty when the handle can
  // actually step: without the facet the call is a no-op and re-marking would
  // let a later Save commit identical bytes.
  const undo = useCallback(() => { if (readOnly || !editor.undo) return; editor.undo(); markDirty(); }, [editor, markDirty, readOnly]);
  const redo = useCallback(() => { if (readOnly || !editor.redo) return; editor.redo(); markDirty(); }, [editor, markDirty, readOnly]);
  const toggleFind = useCallback(() => setFindOpen((value) => !value), []);
  const zoomOut = useCallback(() => setZoom((value) => clampPdfZoom(value - ZOOM_STEP)), []);
  const zoomIn = useCallback(() => setZoom((value) => clampPdfZoom(value + ZOOM_STEP)), []);
  /** F-12: fit the page into the measured canvas pane instead of resetting to
   *  100%. The pane is the frame's scroll container; the page box (including its
   *  /Rotate) comes from the host renderer's page geometry. A pane or page that
   *  cannot be measured yet keeps the current zoom. */
  const fitTo = useCallback((mode: "fit-width" | "fit-page") => {
    const pane = canvasRef.current;
    const canvasPages = editorRef.current.getCanvasPages?.() ?? [];
    const selected = selection?.page;
    const page = canvasPages.find((candidate) => candidate.pageNumber === selected) ?? canvasPages[0];
    if (!pane || !page) return;
    const next = fitPdfZoom(mode, { width: pane.clientWidth, height: pane.clientHeight }, page);
    if (next !== null) setZoom(next);
  }, [selection]);
  const fitWidth = useCallback(() => fitTo("fit-width"), [fitTo]);
  const fitPage = useCallback(() => fitTo("fit-page"), [fitTo]);
  const executeCommand = useCallback((id: PdfCommandId) => {
    if (id === PDF_COMMANDS.save) save("button");
    else if (id === PDF_COMMANDS.undo) undo();
    else if (id === PDF_COMMANDS.redo) redo();
    else if (id === PDF_COMMANDS.rotatePage) rotateSelected();
    else if (id === PDF_COMMANDS.zoomOut) zoomOut();
    else if (id === PDF_COMMANDS.zoomIn) zoomIn();
    else if (id === PDF_COMMANDS.fitWidth) fitWidth();
    else if (id === PDF_COMMANDS.fitPage) fitPage();
    else {
      const panel = PANEL_FOR_COMMAND[id];
      if (panel) setActivePanel(panel);
    }
  }, [fitPage, fitWidth, redo, rotateSelected, save, undo, zoomIn, zoomOut]);
  const keyboardHandler = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); save("shortcut"); }
    else if (key === "f" && !event.shiftKey) { event.preventDefault(); toggleFind(); }
    else if (key === "z" && !event.shiftKey && !isEditableTarget(event.target)) { event.preventDefault(); undo(); }
    else if ((key === "y" || (key === "z" && event.shiftKey)) && !isEditableTarget(event.target)) { event.preventDefault(); redo(); }
  }, [redo, save, toggleFind, undo]);

  const canEditText = capability?.operation === "serialize" && capability.status === "available";
  const canReplaceImage = canEditText;
  const canPageOps = canEditText;
  const canAnnotate = capability?.operation === "serialize" && capability.status === "available";
  /** The browser host owns an in-process page renderer and routes every engine
   * envelope to `applyPdfOpsInBrowser`, which rewrites no content streams and
   * has no Buffer-based page producer, so edit-text, replace-image, insert,
   * extract and merge are refused there (`BROWSER_UNSUPPORTED_COMMANDS`). A
   * handle with no `renderer` is the desktop/Node lane, where they all work. */
  const browserLane = editor.renderer !== undefined;
  const canRunBrowserUnsupported = canEditText && !browserLane;
  const browserUnsupportedHint = browserLane && viewState === "ready" && (activeTab === "edit" || activeTab === "pages");
  const promptMode = failure ? passwordMode(failure) : null;

  // One row per command the ribbon can render; the chrome decides which rows a
  // tab shows and falls back to the catalogue label for each id.
  const commands = useMemo<readonly PdfToolbarCommand[]>(() => {
    // Delete, rotate and reorder share the page-ops capability row and stay on
    // the capability gate; the browser-unsupported commands below are overridden
    // per id because the browser host cannot run them even when the row is
    // available. Each disabled one carries the honest reason in its label so the
    // control never silently does nothing (F-01: the guard below still blocks the
    // action in JS, and the button stays in the tab order via `aria-disabled`).
    const availableByCapability: Readonly<Record<string, boolean>> = {
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.save]]: !readOnly && viewState === "ready",
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.editText]]: canEditText,
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.replaceImage]]: canReplaceImage,
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.deletePage]]: canPageOps,
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.annotations]]: canAnnotate,
      // Zoom and fit are view-only: no document capability gates them, so a
      // ready editor on either lane can always change the zoom.
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.zoomOut]]: viewState === "ready",
    };
    return COMMAND_ORDER.map((id) => {
      const browserReasonKey = pdfCommandDisabledReason(id, browserLane);
      // A handle with no undo/redo facet cannot step history, so
      // disable the control instead of letting it no-op and mark the document dirty.
      const facetMissing = (id === PDF_COMMANDS.undo && !editor.undo) || (id === PDF_COMMANDS.redo && !editor.redo);
      const disabled = facetMissing
        || (browserReasonKey !== undefined
          ? !canRunBrowserUnsupported
          : availableByCapability[CAPABILITY_FOR_COMMAND[id]] !== true);
      return {
        id,
        disabled,
        label: disabled && browserReasonKey ? t(browserReasonKey) : undefined,
        onExecute: () => { if (!disabled) executeCommand(id); },
      };
    });
  }, [browserLane, canAnnotate, canEditText, canPageOps, canReplaceImage, canRunBrowserUnsupported, editor.redo, editor.undo, executeCommand, readOnly, t, viewState]);

  // F1: once ready, the shared Office frame (ribbon, sub-bars, rail, canvas,
  // status bar) is the only chrome; the page header owns the title and Save.
  return (
    <div ref={rootRef} className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", className)} data-testid="pdf-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" aria-label={effectiveTitle} tabIndex={0}>
      {viewState === "ready" ? (
        <PdfEditorSurface
          editor={editor}
          pages={pages}
          readOnly={readOnly}
          zoom={zoom}
          canvasRef={canvasRef}
          selection={selection}
          selectedPage={selectedPage}
          revision={revision}
          activePanel={activePanel}
          onActivePanelChange={setActivePanel}
          findOpen={findOpen}
          onFindClose={() => setFindOpen(false)}
          railOpen={railOpen}
          onSelectPage={(page) => { selectPageNumber(page); setRailOpen(false); }}
          onCanvasSelect={selectPage}
          fontReport={fontReport}
          errorKey={editErrorKey}
          run={runEdit}
          ribbon={<PdfRibbonBar activeTab={activeTab} onTabChange={setActiveTab} commands={commands} findOpen={findOpen} onFindToggle={toggleFind} />}
          banner={browserUnsupportedHint ? (
            <p className="text-caption text-muted-foreground" role="note" data-testid="pdf-browser-unsupported">
              {t(activeTab === "pages" ? "office.pdf.errors.unsupportedPagesInBrowser" : PDF_BROWSER_UNSUPPORTED_REASON_KEY)}
            </p>
          ) : null}
          // The page readout already follows the selected page; object kinds
          // have no translated summary yet, so no raw kind string is shown.
          statusBar={<PdfStatusBar page={selectedPage ?? 1} pageCount={pages.length} zoom={zoom} onZoomChange={setZoom} railOpen={railOpen} onRailToggle={() => setRailOpen((open) => !open)} />}
        />
      ) : viewState === "error" && failure ? (
        promptMode ? (
          <div className="flex min-h-64 min-w-0 flex-1 items-center justify-center overflow-x-auto p-3" data-testid="pdf-password-prompt">
            <PdfPasswordPrompt open mode={promptMode} pending={passwordPending} onSubmit={(password) => { void submitPassword(password); }} onCancel={cancelPassword} />
          </div>
        ) : (
          <PdfErrorState failure={failure} onRetry={() => setRetryToken((value) => value + 1)} />
        )
      ) : <div className="flex min-h-64 min-w-0 flex-1 items-center justify-center px-3 text-center text-body text-muted-foreground" role="status" data-testid="pdf-opening">{t("office.pdf.state.opening")}</div>}
    </div>
  );
}

export type { PdfOpenFailure, PdfOpenOutcome } from "./types";
