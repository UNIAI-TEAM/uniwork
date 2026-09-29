"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { OfficeSaveCoordinatorLike } from "../office-shell";
import { createPptxCommandMap, type PptxCommandCapability, type PptxCommandId } from "./command-map";
import { PptxPresenter } from "./presenter";
import { PptxSlideRail, type PptxSlideView } from "./slide-rail";
import { PptxToolbar } from "./toolbar";

export interface PptxElementView {
  id: string;
  type: string;
  label?: string;
}

export interface PptxEditorProps {
  host: OfficeHost;
  editorHandle: EditorHandle | null;
  slides?: readonly PptxSlideView[];
  elements?: readonly PptxElementView[];
  selectedIndex?: number;
  onSlideSelect?: (index: number) => void;
  onTransform?: (request: SlidesEditTransformRequest) => Promise<unknown>;
  /** A real drag/resize request supplied by the host gesture surface. */
  transformRequest?: SlidesEditTransformRequest | null;
  onTextEdit?: (slideIndex: number) => Promise<unknown>;
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

function makeGesture(): GestureState {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** PPTX renderer mounted by EditorSlot. It renders the current model supplied
 * by the host and never invents a blank deck after an open failure. */
export function PptxEditor({
  host,
  editorHandle,
  slides = [],
  elements = [],
  selectedIndex: controlledIndex,
  onSlideSelect,
  onTransform,
  transformRequest = null,
  onTextEdit,
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
  const [gesturePending, setGesturePending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const historyQueue = useRef<"undo" | "redo" | null>(null);
  const presenterTriggerRef = useRef<HTMLElement | null>(null);
  const editorRootRef = useRef<HTMLElement | null>(null);
  const selectedIndex = Math.min(Math.max(controlledIndex ?? internalIndex, 0), Math.max(slides.length - 1, 0));
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
      case "presenter": presenterTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPresenterOpen(true); break;
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
  }, [fullscreen, onFullscreenChange, onOpen, reportCommandError, requestHistory, runCommand, runTextEdit, runTransform, save, transformRequest]);

  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "PageDown" || event.key === "ArrowDown") { event.preventDefault(); selectSlide(selectedIndex + 1); }
    if (event.key === "PageUp" || event.key === "ArrowUp") { event.preventDefault(); selectSlide(selectedIndex - 1); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); requestHistory(event.shiftKey ? "redo" : "undo"); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); save(); }
  };

  return (
    <section ref={editorRootRef} className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-muted/10", className)} data-pptx-editor data-gesture-pending={gesturePending}>
      <PptxToolbar commands={commands.filter((command) => command.id !== "save" || includeSave)} onCommand={onCommand} />
      {commandError ? <Alert className="m-2" variant="destructive" role="alert"><AlertTitle>{t("command_error_title")}</AlertTitle><AlertDescription>{t("command_error_hint", { message: commandError })}</AlertDescription></Alert> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PptxSlideRail slides={slides} selectedIndex={selectedIndex} onSelect={selectSlide} />
        <div className="flex min-h-48 min-w-0 flex-1 flex-col p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("slide_position", { current: slides.length ? selectedIndex + 1 : 0, total: slides.length })}</span>
            {gesturePending ? <span role="status" data-testid="pptx-gesture-pending">{t("gesture_pending")}</span> : null}
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- role=application is the keyboard slide surface */}
          <div className="relative flex min-h-48 flex-1 items-center justify-center overflow-auto rounded-md border border-border bg-background p-4" role="application" aria-label={t("canvas_label")} tabIndex={0} onKeyDown={onCanvasKeyDown} data-pptx-canvas>
            {slides.length === 0 ? <p className="text-sm text-muted-foreground">{t("no_slides")}</p> : (
              <div className="flex aspect-video w-full max-w-5xl items-center justify-center rounded-sm border border-border bg-muted/30" data-slide-canvas data-slide-index={selectedIndex}>
                {elements.length > 0 ? <div className="grid gap-2 text-center text-caption text-muted-foreground">{elements.map((element) => <span key={element.id} data-element-id={element.id}>{element.label ?? element.type}</span>)}</div> : <span className="text-sm text-muted-foreground">{slides[selectedIndex]?.label ?? t("slide_number", { index: selectedIndex + 1 })}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
      <PptxPresenter
        slides={slides}
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
