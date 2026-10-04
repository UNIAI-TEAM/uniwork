"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the editor landmark owns keyboard shortcuts */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { Notice } from "../../common/notice";
import { PdfErrorState } from "./pdf-error-state";
import { PdfPasswordPrompt, type PdfPasswordMode } from "./password";
import { PdfPagePanel } from "./pdf-page-panel";
import { PdfToolbar } from "./pdf-toolbar";
import { PdfPrintButton } from "./print";
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

export function PdfEditor<TSnapshot = PdfSnapshot>({ documentKey, editor, open, coordinator, capability, title, className, onOpen, onSelectionChange }: PdfEditorProps<TSnapshot>) {
  const { t } = useTranslation();
  const [viewState, setViewState] = useState<PdfViewState>("opening");
  const [failure, setFailure] = useState<PdfOpenFailure | null>(null);
  const [snapshot, setSnapshot] = useState<PdfSnapshot | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [fontReport, setFontReport] = useState(() => editor.getFontReport?.() ?? null);
  const [coordinatorState, setCoordinatorState] = useState(() => coordinator.getState());
  const [retryToken, setRetryToken] = useState(0);
  const [passwordPending, setPasswordPending] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const disposedRef = useRef(false);
  const passwordControllerRef = useRef<AbortController | null>(null);
  const editorRef = useRef(editor);
  const openRef = useRef(open);
  const coordinatorRef = useRef(coordinator);
  const capabilityRef = useRef(capability);
  const onOpenRef = useRef(onOpen);
  const translateRef = useRef(t);
  const [editFailure, setEditFailure] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
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
    setCoordinatorState(coordinator.getState());
    return coordinator.subscribe(setCoordinatorState);
  }, [coordinator, documentKey]);

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
    setEditFailure(false);
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
  }, [coordinator, editor, refreshSnapshot]);

  const applyEdit = useCallback(async (operation: Parameters<NonNullable<typeof editor.edit>>[0][number]) => {
    if (readOnly || !editor.edit) return;
    setEditFailure(false);
    try {
      await editor.edit([operation]);
      markDirty();
    } catch {
      setEditFailure(true);
    }
  }, [editor, markDirty, readOnly]);

  const selectPage = useCallback((page: number) => {
    const next: PdfSelection = { page, objectId: null, kind: "page" };
    setSelection(next);
    editor.selection?.setSelection?.(next);
    onSelectionChange?.(next);
  }, [editor.selection, onSelectionChange]);

  const save = useCallback((entryPoint: "button" | "shortcut" = "button") => {
    if (viewState !== "ready" || readOnly) return;
    void coordinator.save(entryPoint);
  }, [coordinator, readOnly, viewState]);

  const undo = useCallback(() => { if (readOnly) return; editor.undo?.(); markDirty(); }, [editor, markDirty, readOnly]);
  const redo = useCallback(() => { if (readOnly) return; editor.redo?.(); markDirty(); }, [editor, markDirty, readOnly]);
  const keyboardHandler = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); save("shortcut"); }
    else if (key === "z" && !event.shiftKey && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); undo(); }
    else if ((key === "y" || (key === "z" && event.shiftKey)) && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); redo(); }
  }, [redo, save, undo]);

  const dirty = coordinatorState.state === "dirty" || coordinatorState.dirtyGeneration > coordinatorState.lastSavedGeneration;
  const saving = coordinatorState.state === "saving";
  const canEditText = capability?.operation === "serialize" && capability.status === "available";
  const canReplaceImage = canEditText;
  const canPageOps = canEditText;
  const canAnnotate = false;
  const promptMode = failure ? passwordMode(failure) : null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", className)} data-testid="pdf-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" aria-label={effectiveTitle} tabIndex={0}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2"><h1 className="min-w-0 truncate text-title font-semibold">{effectiveTitle}</h1><div className="flex items-center gap-2"><span className="text-caption text-muted-foreground" data-testid="pdf-open-state">{viewState === "opening" ? t("office.pdf.state.opening") : viewState === "ready" ? t(`office.pdf.saveState.${coordinatorState.state}`) : t("office.pdf.state.error")}</span><PdfPrintButton surfaceRef={surfaceRef} disabled={viewState !== "ready"} /></div></header>
      {viewState === "ready" ? (
        <>
          <PdfToolbar coordinator={coordinator} dirty={dirty} saving={saving} readOnly={readOnly} selection={selection} canUndo={typeof editor.undo === "function"} canRedo={typeof editor.redo === "function"} canEditText={canEditText} canReplaceImage={canReplaceImage} canPageOps={canPageOps} canAnnotate={canAnnotate} onUndo={undo} onRedo={redo} onEditText={() => { if (selection?.kind === "text") setTextDraft(""); }} onReplaceImage={() => { setImageAssetId(""); }} onInsertPage={() => void applyEdit({ op: "insert_page", target: { index: pages.length } })} onDeletePage={() => { if (selectedPage !== null) void applyEdit({ op: "delete_page", target: { page: selectedPage } }); }} onRotatePage={() => { if (selectedPage !== null) void applyEdit({ op: "rotate_page", target: { page: selectedPage }, degrees: 90 }); }} onReorderPage={() => { if (selectedPage !== null) void applyEdit({ op: "reorder_page", target: { page: selectedPage }, index: Math.max(0, selectedPage - 2) }); }} onExtractPage={() => { if (selectedPage !== null) void applyEdit({ op: "extract_page", target: { page: selectedPage } }); }} onMergePages={() => void applyEdit({ op: "merge_pages", target: { pages: pages.map((page) => page.pageNumber) } })} onSave={() => save("button")} />
          <div className="flex min-h-0 flex-1" data-testid="pdf-canvas">
            <PdfPagePanel pages={pages} selectedPage={selectedPage} disabled={readOnly} onSelect={selectPage} onReorder={(page, index) => void applyEdit({ op: "reorder_page", target: { page }, index })} onExtract={(page) => void applyEdit({ op: "extract_page", target: { page } })} />
            <div className="min-h-64 min-w-0 flex-1 overflow-auto bg-muted/20 p-4 sm:p-8">
              {editFailure ? <Notice tone="destructive" icon={AlertTriangle} live="assertive" className="mb-3">{t("office.pdf.errors.editFailed")}</Notice> : null}
              {fontReport?.missing.length ? <div data-testid="pdf-font-warning"><Notice tone="warning" icon={AlertTriangle} live="polite" className="mb-3">{t("office.pdf.fonts.missing", { fonts: fontReport.missing.join(", ") })}</Notice></div> : null}
              <div ref={surfaceRef} className="mx-auto min-h-[24rem] w-full max-w-4xl rounded-lg border border-border bg-background p-8 shadow-sm" data-testid="pdf-document-surface"><p className="text-caption text-muted-foreground">{t("office.pdf.surface.ready")}</p><p className="mt-2 text-caption text-muted-foreground">{t("office.pdf.surface.page", { page: selectedPage ?? 1, count: pages.length })}</p></div>
              {selection?.kind === "text" && !readOnly ? <div className="mt-3 flex gap-2"><label htmlFor="pdf-text-edit" className="sr-only">{t("office.pdf.edit.textLabel")}</label><input id="pdf-text-edit" value={textDraft} onChange={(event) => setTextDraft(event.target.value)} className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-caption" placeholder={t("office.pdf.edit.textPlaceholder")} /><Button type="button" variant="outline" size="sm" onClick={() => { if (selection.objectId) void applyEdit({ op: "replace_text", target: { page: selection.page, objectId: selection.objectId }, text: textDraft }); }}>{t("office.pdf.edit.applyText")}</Button></div> : null}
              {selection?.kind === "image" && !readOnly ? <div className="mt-3 flex gap-2"><label htmlFor="pdf-image-asset" className="sr-only">{t("office.pdf.edit.imageLabel")}</label><input id="pdf-image-asset" value={imageAssetId} onChange={(event) => setImageAssetId(event.target.value)} className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-caption" placeholder={t("office.pdf.edit.imagePlaceholder")} /><Button type="button" variant="outline" size="sm" onClick={() => { if (selection.objectId && imageAssetId) void applyEdit({ op: "replace_image", target: { page: selection.page, objectId: selection.objectId }, assetId: imageAssetId }); }}>{t("office.pdf.edit.applyImage")}</Button></div> : null}
            </div>
          </div>
        </>
      ) : viewState === "error" && failure ? (
        promptMode ? (
          <div className="flex min-h-64 flex-1 items-center justify-center" data-testid="pdf-password-prompt">
            <PdfPasswordPrompt open mode={promptMode} pending={passwordPending} onSubmit={(password) => { void submitPassword(password); }} onCancel={cancelPassword} />
          </div>
        ) : (
          <PdfErrorState failure={failure} onRetry={() => setRetryToken((value) => value + 1)} />
        )
      ) : <div className="flex min-h-64 flex-1 items-center justify-center text-body text-muted-foreground" role="status" data-testid="pdf-opening">{t("office.pdf.state.opening")}</div>}
    </div>
  );
}

export type { PdfOpenFailure, PdfOpenOutcome } from "./types";
