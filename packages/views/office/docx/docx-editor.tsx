"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- the editor application landmark captures the host Save shortcut */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { DocxErrorState } from "./docx-error-state";
import { DocxToolbar } from "./docx-toolbar";
import type {
  DocxEditorProps,
  DocxOpenFailure,
  DocxOpenOutcome,
  DocxSelection,
  DocxViewState,
} from "./types";

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
  onOpen,
  onSelectionChange,
}: DocxEditorProps<TSnapshot>) {
  const { t } = useTranslation();
  const [viewState, setViewState] = useState<DocxViewState>("opening");
  const [failure, setFailure] = useState<DocxOpenFailure | null>(null);
  const [selection, setSelection] = useState<DocxSelection | null>(null);
  const [coordinatorState, setCoordinatorState] = useState(() => coordinator.getState());
  const [retryToken, setRetryToken] = useState(0);
  const disposedRef = useRef(false);

  const readOnly = capability !== undefined && capability.status !== "available";
  const effectiveTitle = title ?? t("office.docx.title");

  useEffect(() => {
    setCoordinatorState(coordinator.getState());
    return coordinator.subscribe(setCoordinatorState);
  }, [coordinator, documentKey]);

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
    const controller = new AbortController();
    disposedRef.current = false;
    setViewState("opening");
    setFailure(null);

    const run = async () => {
      if (readOnly) {
        const blocked: DocxOpenFailure = {
          outcome: "failed",
          document_id: documentKey,
          format: "docx",
          failure_class: "unsupported_feature",
          message: capability?.reason ?? t("office.docx.errors.capabilityUnavailable"),
        };
        setFailure(blocked);
        setViewState("error");
        onOpen?.(blocked);
        return;
      }

      try {
        const outcome = await open.open(controller.signal);
        if (controller.signal.aborted || disposedRef.current) return;
        onOpen?.(outcome);
        if (isFailure(outcome)) {
          setFailure(outcome);
          setViewState("error");
          return;
        }
        // The host's EditorHandle owns session state. The public G2 open port
        // only supplies the typed outcome and model reference.
        await editor.open();
        if (controller.signal.aborted || disposedRef.current) return;
        setViewState("ready");
      } catch (error) {
        if (controller.signal.aborted || disposedRef.current) return;
        const next = unexpectedFailure(documentKey, error);
        setFailure(next);
        setViewState("error");
        onOpen?.(next);
      }
    };
    void run();

    return () => {
      disposedRef.current = true;
      controller.abort();
      void editor.cancel?.("document_changed");
      void coordinator.cancel?.();
      void editor.dispose();
    };
  }, [capability?.reason, documentKey, editor, open, readOnly, retryToken, t, coordinator, onOpen, capability]);

  const save = useCallback(() => {
    if (viewState !== "ready" || readOnly) return;
    void coordinator.save("button");
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
      save();
    }
  }, [save]);

  const canUndo = useMemo(() => typeof editor.undo === "function", [editor.undo]);
  const canRedo = useMemo(() => typeof editor.redo === "function", [editor.redo]);
  const dirty = coordinatorState.state === "dirty" || coordinatorState.dirtyGeneration > coordinatorState.lastSavedGeneration;
  const saving = coordinatorState.state === "saving";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", className)} data-testid="docx-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" tabIndex={-1}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h1 className="min-w-0 truncate text-title font-semibold">{effectiveTitle}</h1>
        <span className="text-caption text-muted-foreground" data-testid="docx-open-state">
          {viewState === "opening" ? t("office.docx.state.opening") : viewState === "ready" ? t(`office.docx.saveState.${coordinatorState.state}`) : t("office.docx.state.error")}
        </span>
      </header>
      {viewState === "ready" ? (
        <>
          <DocxToolbar
            coordinator={coordinator}
            dirty={dirty}
            saving={saving}
            readOnly={readOnly}
            selection={selection}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onSave={save}
          />
          <div className="flex min-h-64 flex-1 items-start justify-center overflow-auto bg-muted/20 p-4 sm:p-8" data-testid="docx-canvas">
            <div className="min-h-[24rem] w-full max-w-4xl rounded-lg border border-border bg-background p-8 shadow-sm" data-testid="docx-document-surface">
              <p className="text-caption text-muted-foreground">{t("office.docx.surface.ready")}</p>
            </div>
          </div>
        </>
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
