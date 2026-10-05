"use client";

/**
 * Transform gestures and the undo/redo journal of the PPTX editor (UNI-927 W5).
 *
 * A transform runs through the host channel one at a time; an undo/redo asked
 * for while one is in flight is queued and runs when it settles, so history
 * never interleaves with a half-applied gesture.
 *
 * F-15: Ctrl+Z / Ctrl+Y also work while focus sits on a panel control or the
 * ribbon. The listener is on `document` in the bubble phase, so React's canvas
 * handler (which prevents the event) has already run; it only acts for events
 * from inside the editor root and leaves native text undo to text inputs.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import { matchPptxShortcut } from "./shortcuts/pptx-shortcuts";
import { isNativeTextTarget } from "./text/native-text-target";

interface GestureState {
  promise: Promise<void>;
  resolve: () => void;
}

function makeGesture(): GestureState {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export interface PptxGestureHistoryInput {
  host: OfficeHost;
  editorHandle: EditorHandle | null;
  onTransform?: (request: SlidesEditTransformRequest) => Promise<unknown>;
  onDirty?: () => void;
  onStart: () => void;
  rootRef: RefObject<HTMLElement | null>;
}

export function usePptxGestureHistory({ host, editorHandle, onTransform, onDirty, onStart, rootRef }: PptxGestureHistoryInput) {
  const [gesturePending, setGesturePending] = useState(false);
  const gestureRef = useRef<GestureState | null>(null);
  const historyQueue = useRef<"undo" | "redo" | null>(null);

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
    onStart();
    try {
      const result = onTransform
        ? await onTransform(request)
        : await host.ipc.call("host:slides-edit-transform", request);
      onDirty?.();
      return result;
    } finally {
      finishGesture();
    }
  }, [finishGesture, host.ipc, onDirty, onStart, onTransform]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (event.defaultPrevented || !root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      if (isNativeTextTarget(event.target)) return;
      const binding = matchPptxShortcut(event);
      if (binding?.action === "undo" || binding?.action === "redo") {
        event.preventDefault();
        requestHistory(binding.action);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestHistory, rootRef]);

  return { gesturePending, waitForGesture, requestHistory, runTransform };
}
