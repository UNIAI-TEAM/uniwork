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
import { PDF_COMMANDS, PDF_COMMAND_CAPABILITIES, type PdfCommandId } from "./pdf-command-map";
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
];

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

  // A host that reports byte changes itself (async undo/redo) refreshes the view without marking dirty.
  useEffect(() => editor.subscribe?.(() => {
    refreshSnapshot();
    setRevision((value) => value + 1);
  }), [editor, refreshSnapshot]);

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

  const undo = useCallback(() => { if (readOnly) return; editor.undo?.(); markDirty(); }, [editor, markDirty, readOnly]);
  const redo = useCallback(() => { if (readOnly) return; editor.redo?.(); markDirty(); }, [editor, markDirty, readOnly]);
  const executeCommand = useCallback((id: PdfCommandId) => {
    if (id === PDF_COMMANDS.save) save("button");
    else if (id === PDF_COMMANDS.undo) undo();
    else if (id === PDF_COMMANDS.redo) redo();
    else if (id === PDF_COMMANDS.rotatePage) rotateSelected();
    else {
      const panel = PANEL_FOR_COMMAND[id];
      if (panel) setActivePanel(panel);
    }
  }, [redo, rotateSelected, save, undo]);
  const keyboardHandler = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); save("shortcut"); }
    else if (key === "z" && !event.shiftKey && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); undo(); }
    else if ((key === "y" || (key === "z" && event.shiftKey)) && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); redo(); }
  }, [redo, save, undo]);

  const canEditText = capability?.operation === "serialize" && capability.status === "available";
  const canReplaceImage = canEditText;
  const canPageOps = canEditText;
  const canAnnotate = capability?.operation === "serialize" && capability.status === "available";
  const promptMode = failure ? passwordMode(failure) : null;

  // One row per command the ribbon can render; the chrome decides which rows a
  // tab shows and falls back to the catalogue label for each id.
  const commands = useMemo<readonly PdfToolbarCommand[]>(() => {
    const availableByCapability: Readonly<Record<string, boolean>> = {
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.save]]: !readOnly && viewState === "ready",
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.editText]]: canEditText,
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.replaceImage]]: canReplaceImage,
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.insertPage]]: canPageOps,
      [CAPABILITY_FOR_COMMAND[PDF_COMMANDS.annotations]]: canAnnotate,
    };
    return COMMAND_ORDER.map((id) => ({
      id,
      disabled: availableByCapability[CAPABILITY_FOR_COMMAND[id]] !== true,
      onExecute: () => executeCommand(id),
    }));
  }, [canAnnotate, canEditText, canPageOps, canReplaceImage, executeCommand, readOnly, viewState]);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", className)} data-testid="pdf-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" aria-label={effectiveTitle} tabIndex={0}>
      {viewState === "ready" ? (
        <PdfRibbonBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          commands={commands}
          findOpen={findOpen}
          onFindToggle={() => setFindOpen((value) => !value)}
        />
      ) : null}
      {viewState === "ready" ? (
        <PdfEditorSurface
          editor={editor}
          pages={pages}
          readOnly={readOnly}
          zoom={zoom}
          selection={selection}
          selectedPage={selectedPage}
          revision={revision}
          activePanel={activePanel}
          onActivePanelChange={setActivePanel}
          findOpen={findOpen}
          onFindClose={() => setFindOpen(false)}
          onSelectPage={selectPageNumber}
          onCanvasSelect={selectPage}
          fontReport={fontReport}
          errorKey={editErrorKey}
          run={runEdit}
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
      {viewState === "ready" ? <PdfStatusBar page={selectedPage ?? 1} pageCount={pages.length} counts={{}} language={undefined} selection={selection ? String(selection.kind) : null} zoom={zoom} onZoomChange={setZoom} /> : null}
    </div>
  );
}

export type { PdfOpenFailure, PdfOpenOutcome } from "./types";
