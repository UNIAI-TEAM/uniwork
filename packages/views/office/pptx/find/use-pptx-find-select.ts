"use client";

/**
 * Show the find panel's active hit on the canvas (UNI-927 R2-6).
 *
 * The hit is an intent: move to its slide, then select its element once the
 * rendition for that slide is mounted. Element ids repeat across slides, so the
 * selection waits for the target slide's own boxes (the same rule the
 * select-after-insert hook follows), and the intent is dropped as soon as it has
 * fired - a later canvas click is never overridden by a stale hit.
 */
import { useCallback, useEffect, useState } from "react";
import { useOfficeDocumentActiveRef } from "../../common/document-active";
import type { PptxNodeBox } from "../canvas/render-tree";
import type { PptxFindHit } from "./pptx-find-model";

interface PptxFindSelectInput {
  slideIndex: number;
  selectSlide: (index: number) => void;
  boxes: readonly PptxNodeBox[];
  /** True once `boxes` come from a mounted rendition (not while one is building). */
  ready: boolean;
  select: (ids: readonly string[]) => void;
}

/** Returns the `onActiveHitChange` callback for the find panel. */
export function usePptxFindSelect({ slideIndex, selectSlide, boxes, ready, select }: PptxFindSelectInput): (hit: PptxFindHit | null) => void {
  const [target, setTarget] = useState<PptxFindHit | null>(null);
  const activeRef = useOfficeDocumentActiveRef();
  const onActiveHitChange = useCallback((hit: PptxFindHit | null) => setTarget(hit), []);

  // X4fix F9: a pointer press while the hit waits for its slide's rendition is
  // the user taking over; the stale intent must not select over their click.
  // (A press on the panel's own Next/Previous lands its new hit after this.)
  useEffect(() => {
    if (!target) return;
    // UNI-957: only a press in the visible document is the user taking over.
    const drop = () => { if (activeRef.current) setTarget(null); };
    document.addEventListener("pointerdown", drop, true);
    return () => document.removeEventListener("pointerdown", drop, true);
  }, [activeRef, target]);

  useEffect(() => {
    if (!target) return;
    if (target.slideIndex !== slideIndex) {
      selectSlide(target.slideIndex);
      return;
    }
    if (!ready) return;
    setTarget(null);
    // A run whose element is not on the canvas (a hidden node) still got its slide shown.
    if (target.elementId && boxes.some((box) => box.sourceId === target.elementId)) select([target.elementId]);
  }, [boxes, ready, select, selectSlide, slideIndex, target]);

  return onActiveHitChange;
}
