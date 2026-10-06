"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the editor application landmark captures the host Save shortcut */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { DocxCommandRuntime, DocxRuntimeFormatState } from "./commands";
import { DocxContextMenuSurface } from "./context-menu/docx-context-menu-surface";
import { getDocxLiveEditor, subscribeDocxLiveEditor } from "./editor-store";
import { OfficeFrame } from "../frame/office-frame";
import { DocxErrorState } from "./docx-error-state";
import { DocxToolbar } from "./docx-toolbar";
import { DocxFindPanel } from "./find/docx-find-panel";
import { DocxShortcutsHelp } from "./shortcuts/docx-shortcuts-help";
import { DocxStatusBar } from "./status-bar";
import type { DocxToolbarGroupContext } from "./toolbar/types";
import type {
  DocxEditorProps,
  DocxFormatState,
  DocxOpenFailure,
  DocxOpenOutcome,
  DocxSelection,
  DocxViewState,
} from "./types";
import { DocxViewChrome } from "./view";

function unexpectedFailure(documentId: string, error: unknown): DocxOpenFailure {
  return {
    outcome: "failed",
    document_id: documentId,
    format: "docx",
    failure_class: "engine_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function isFailure(outcome: DocxOpenOutcome): outcome is DocxOpenFailure {
  return outcome.outcome === "failed";
}

/**
 * The DOCX format view is a slot consumer: G3-03a supplies the surrounding
 * shell and G3-01 supplies the EditorHandle/coordinator. The view owns only
 * format commands and the open-error boundary; it never reads or writes bytes.
 */
export function DocxEditor<TSnapshot = unknown>({
  documentKey,
  editor,
  open,
  coordinator,
  capability,
  title,
  className,
  manageSession = true,
  showDocumentControls = true,
  onOpen,
  onSelectionChange,
}: DocxEditorProps<TSnapshot>) {
  const { t } = useTranslation();
  const [viewState, setViewState] = useState<DocxViewState>("opening");
  const [failure, setFailure] = useState<DocxOpenFailure | null>(null);
  const [selection, setSelection] = useState<DocxSelection | null>(null);
  const [formatState, setFormatState] = useState<DocxFormatState | null>(() => editor.commands?.getState() ?? null);
  const [coordinatorState, setCoordinatorState] = useState(() => coordinator.getState());
  const [retryToken, setRetryToken] = useState(0);
  const disposedRef = useRef(false);
  const editorRef = useRef(editor);
  const openRef = useRef(open);
  const coordinatorRef = useRef(coordinator);
  const capabilityRef = useRef(capability);
  const onOpenRef = useRef(onOpen);
  const translateRef = useRef(t);
  editorRef.current = editor;
  openRef.current = open;
  coordinatorRef.current = coordinator;
  capabilityRef.current = capability;
  onOpenRef.current = onOpen;
  translateRef.current = t;

  const readOnly = capability?.operation !== "serialize" || capability.status !== "available";
  // The context menu needs a TipTap Editor, not the host handle: read the
  // editor the lane publishes from its schema extension (./editor-store).
  const liveEditor = useSyncExternalStore(subscribeDocxLiveEditor, getDocxLiveEditor, getDocxLiveEditor);
  // Capability identity is semantic input to the session. Keep the object and
  // callbacks in refs so shell identity churn does not restart an active open.
  const capabilityStatus = capability?.status;
  const capabilityOperation = capability?.operation;
  const effectiveTitle = title ?? t("office.docx.title");

  useEffect(() => {
    setCoordinatorState(coordinator.getState());
    return coordinator.subscribe(setCoordinatorState);
  }, [coordinator, documentKey]);

  useEffect(() => editor.subscribeDirty?.((generation) => coordinator.markDirty?.(generation)), [editor, coordinator]);

  useEffect(() => {
    const selectionPort = editor.selection;
    if (!selectionPort) {
      setSelection(null);
      onSelectionChange?.(null);
      return undefined;
    }
    const emit = (next: DocxSelection | null) => {
      setSelection(next);
      onSelectionChange?.(next);
    };
    emit(selectionPort.getSelection());
    return selectionPort.subscribe?.(emit);
  }, [editor, onSelectionChange, documentKey]);

  useEffect(() => {
    const commands = editor.commands;
    if (!commands) {
      setFormatState(null);
      return undefined;
    }
    setFormatState(commands.getState());
    return commands.subscribe(setFormatState);
  }, [editor, documentKey]);

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

    const run = async () => {
      if (activeCapability?.operation !== "serialize" || activeCapability.status !== "available") {
        const blocked: DocxOpenFailure = {
          outcome: "failed",
          document_id: documentKey,
          format: "docx",
          failure_class: "unsupported_feature",
          message: activeCapability?.reason ?? translate("office.docx.errors.capabilityUnavailable"),
        };
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
        // The host's EditorHandle owns session state. The public G2 open port
        // only supplies the typed outcome and model reference.
        await activeEditor.open();
        if (controller.signal.aborted || disposedRef.current) return;
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
      if (manageSession) {
        void activeEditor.cancel?.("document_changed");
        void activeCoordinator.cancel?.();
        void activeEditor.dispose();
      }
    };
    // The session is keyed by documentKey/retryToken. Callback and adapter
    // objects are refs so a shell re-render cannot cancel an active document.
  }, [documentKey, retryToken, capabilityOperation, capabilityStatus, manageSession]);

  const save = useCallback((entryPoint: "button" | "shortcut" = "button") => {
    if (viewState !== "ready" || readOnly) return;
    void coordinator.save(entryPoint);
  }, [coordinator, readOnly, viewState]);

  const markDirtyFromHandle = useCallback(() => {
    coordinator.markDirty?.(editor.getDirtyGeneration());
  }, [coordinator, editor]);

  const undo = useCallback(() => {
    editor.undo?.();
    markDirtyFromHandle();
  }, [editor, markDirtyFromHandle]);

  const redo = useCallback(() => {
    editor.redo?.();
    markDirtyFromHandle();
  }, [editor, markDirtyFromHandle]);

  const keyboardHandler = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save("shortcut");
    }
  }, [save]);

  const canUndo = useMemo(() => typeof editor.undo === "function", [editor.undo]);
  const canRedo = useMemo(() => typeof editor.redo === "function", [editor.redo]);
  const dirty = coordinatorState.state === "dirty" || coordinatorState.dirtyGeneration > coordinatorState.lastSavedGeneration;
  const saving = coordinatorState.state === "saving";

  // A host stub may supply only the base format contract; a real session always
  // mounts the composed runtime from createDocxCommandRuntime, so the shared
  // toolbar/chrome context asserts the runtime types once, here.
  const sharedContext: DocxToolbarGroupContext = {
    editor,
    coordinator,
    format: formatState as DocxRuntimeFormatState | null,
    commands: editor.commands as DocxCommandRuntime | undefined,
    selection,
    readOnly,
    saving,
    dirty,
    canUndo,
    canRedo,
    onUndo: undo,
    onRedo: redo,
    onSave: showDocumentControls ? save : undefined,
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background", className)} data-testid="docx-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" aria-label={effectiveTitle} tabIndex={0}>
      {showDocumentControls ? <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h1 className="min-w-0 truncate text-title font-semibold">{effectiveTitle}</h1>
        <span className="text-caption text-muted-foreground" data-testid="docx-open-state">
          {viewState === "opening" ? t("office.docx.state.opening") : viewState === "ready" ? t(`office.docx.saveState.${coordinatorState.state}`) : t("office.docx.state.error")}
        </span>
      </header> : null}
      {viewState === "ready" ? (
        <OfficeFrame
          className="bg-office-canvas"
          ribbon={<DocxToolbar {...sharedContext} />}
          subbar={<DocxFindPanel {...sharedContext} />}
          statusBar={<DocxStatusBar selection={selection} help={<DocxShortcutsHelp {...sharedContext} />} />}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-col" data-testid="docx-canvas">
            {/* A6-wire: attaches the zoom controller to the surface below and
                draws the ruler above the pages; resolves the surface from the
                DOM because the handle exposes no engine accessors. */}
            <DocxViewChrome />
            {editor.renderSurface ? (
              // The real context menu wraps the mounted document surface; it
              // needs the live TipTap editor, so it only appears once the
              // schema extension has published one (the wrapper is skipped
              // while a stub handle renders without an engine).
              liveEditor ? (
                <DocxContextMenuSurface editor={liveEditor} readOnly={readOnly}>
                  {editor.renderSurface()}
                </DocxContextMenuSurface>
              ) : (
                editor.renderSurface()
              )
            ) : (
              <p className="p-8 text-caption text-muted-foreground">{t("office.docx.surface.ready")}</p>
            )}
          </div>
        </OfficeFrame>
      ) : viewState === "error" && failure ? (
        <DocxErrorState failure={failure} onRetry={() => setRetryToken((value) => value + 1)} />
      ) : (
        <div className="flex min-h-64 flex-1 items-center justify-center text-body text-muted-foreground" role="status" data-testid="docx-opening">
          {t("office.docx.state.opening")}
        </div>
      )}
    </div>
  );
}

export type { DocxOpenFailure, DocxOpenOutcome } from "./types";
