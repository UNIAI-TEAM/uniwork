"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import { HostCapabilityRefusal, type SlidesEditTransformRequest } from "@uniwork/office-contracts";
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
  onTextEdit?: (slideIndex: number) => Promise<unknown>;
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
  onTextEdit,
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
  const gestureRef = useRef<GestureState | null>(null);
  const historyQueue = useRef<"undo" | "redo" | null>(null);
  const presenterTriggerRef = useRef<HTMLElement | null>(null);
  const selectedIndex = Math.min(Math.max(controlledIndex ?? internalIndex, 0), Math.max(slides.length - 1, 0));
  const commands = useMemo(() => createPptxCommandMap({ host, capabilities, includeSave: includeSave && Boolean(saveCoordinator), includePresentation: true }), [capabilities, host, includeSave, saveCoordinator]);

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
    try {
      const result = onTransform
        ? await onTransform(request)
        : await host.ipc.call("host:slides-edit-transform", request);
      onDirty?.();
      return result;
    } catch (error) {
      if (error instanceof HostCapabilityRefusal) throw error;
      throw error;
    } finally {
      finishGesture();
    }
  }, [finishGesture, host.ipc, onDirty, onTransform]);

  const runTextEdit = useCallback(async () => {
    await waitForGesture();
    if (onTextEdit) await onTextEdit(selectedIndex);
    else {
      // Text editing is a separate host channel. The renderer does not
      // mutate a DOM label and call that a file edit.
      await host.ipc.call("host:slides-edit-text", { slideIndex: selectedIndex, paragraphs: [{ runs: [{ text: "" }] }] });
    }
    onDirty?.();
  }, [host.ipc, onDirty, onTextEdit, selectedIndex, waitForGesture]);

  const save = useCallback(() => {
    if (saveCoordinator) void saveCoordinator.save("button");
  }, [saveCoordinator]);

  const onCommand = useCallback((id: PptxCommandId) => {
    switch (id) {
      case "edit-shape-image":
        void runTransform({ slideIndex: selectedIndex, sourceId: elements[0]?.id ?? null, xPx: 0, yPx: 0, wPx: 320, hPx: 180, fitWidthPx: 960 });
        break;
      case "edit-text": void runTextEdit(); break;
      case "undo": requestHistory("undo"); break;
      case "redo": requestHistory("redo"); break;
      case "save": save(); break;
      case "presenter": presenterTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPresenterOpen(true); break;
      case "fullscreen": void document.querySelector<HTMLElement>("[data-pptx-editor]")?.requestFullscreen?.(); break;
      default: break;
    }
  }, [elements, requestHistory, runTextEdit, runTransform, save, selectedIndex]);

  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "PageDown" || event.key === "ArrowDown") { event.preventDefault(); selectSlide(selectedIndex + 1); }
    if (event.key === "PageUp" || event.key === "ArrowUp") { event.preventDefault(); selectSlide(selectedIndex - 1); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); requestHistory(event.shiftKey ? "redo" : "undo"); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); save(); }
  };

  return (
    <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-muted/10", className)} data-pptx-editor data-gesture-pending={gesturePending}>
      <PptxToolbar commands={commands.filter((command) => command.id !== "save" || includeSave)} onCommand={onCommand} />
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
