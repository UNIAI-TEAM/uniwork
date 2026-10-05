"use client";

/**
 * The selection/gesture controller mounted over the P0-2 canvas.
 *
 * One hook owns three pieces of view state — the selection, the live marquee and
 * the open drag gesture — and turns pointer events into (a) preview updates with
 * no engine traffic and (b) exactly one committed transform per gesture on
 * pointer-up. Selection is component state; nothing here reaches a core store
 * or the server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import type { PptxNodeBox } from "../canvas/render-tree";
import { applyGesture, beginGesture, gestureCommitRequests, gestureHandleAt, gestureIsNoop, type PptxGesture } from "./gesture";
import { hitElement, marqueeSelection, normalizeRect, selectionBounds, type PptxBox, type PptxPoint } from "./geometry";
import { EMPTY_SELECTION, pruneSelection, selectAt, setSelection, type PptxSelectionState } from "./selection-model";

/** On-screen hit radius for the resize/rotate handles. */
const HANDLE_HIT_RADIUS_PX = 7;

export interface UsePptxSelectionOptions {
  /** 0-based slide the boxes belong to. */
  slideIndex: number;
  /** Absolute page boxes of the current slide (`collectRenderNodeBoxes`). */
  boxes: readonly PptxNodeBox[];
  page: { widthPx: number; heightPx: number };
  fitWidthPx: number;
  /** Display px per page px (zoom included); handle hit-testing uses it. */
  scale: number;
  /** The canvas only accepts gestures once a real rendition is mounted. */
  interactive: boolean;
  /** One committed transform. Resolves when the host accepted it. */
  commitTransform?: (request: SlidesEditTransformRequest) => Promise<unknown>;
  /** Optional delete channel; absent means Delete stays unbound (honest). */
  deleteElements?: (slideIndex: number, elementIds: readonly string[]) => Promise<unknown>;
  /** Called once after a delete commits; a transform already reports through
   *  `commitTransform`, so this stays the delete channel's own signal. */
  onDeleteCommitted?: () => void;
  onError?: (error: unknown) => void;
}

export interface PptxSelectionPreviewBox {
  sourceId: string;
  box: PptxBox;
}

export interface PptxSelectionController {
  selection: PptxSelectionState;
  /** Union bounds of the selection in page px (null when nothing is selected). */
  bounds: PptxBox | null;
  /** Live gesture preview boxes (empty when no gesture is open). */
  previews: readonly PptxSelectionPreviewBox[];
  /** Live marquee rectangle in page px (null when not dragging one). */
  marquee: PptxBox | null;
  canDelete: boolean;
  clear(): void;
  /** Replace the selection with the given ids that exist on the current rendition (unknown ids are
   *  ignored; no gesture or marquee side effects). For programmatic selection, e.g. after an insert. */
  select(ids: readonly string[]): void;
  selectAll(): void;
  deleteSelection(): void;
  onPointerDown(point: PptxPoint, additive: boolean): void;
  onPointerMove(point: PptxPoint, shiftKey: boolean): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  /** Right-click: select the element under the pointer (PowerPoint-like) without a gesture. */
  onContextPointerDown(point: PptxPoint): void;
  /** Topmost selectable element under a page point - the same hit test a click uses. */
  elementAt(point: PptxPoint): string | null;
}

export function usePptxSelection(options: UsePptxSelectionOptions): PptxSelectionController {
  const { boxes, deleteElements, interactive, onDeleteCommitted, onError, page, slideIndex } = options;
  const [selection, setSelectionState] = useState<PptxSelectionState>(EMPTY_SELECTION);
  const [gesture, setGesture] = useState<PptxGesture | null>(null);
  const [marquee, setMarquee] = useState<PptxBox | null>(null);
  const marqueeStart = useRef<PptxPoint | null>(null);
  const marqueeAdditive = useRef(false);
  /** Element clicked inside an existing selection; a click that never moved
   *  collapses the selection onto it on pointer-up. */
  const clickTarget = useRef<string | null>(null);
  const commitRef = useRef(options.commitTransform);
  const fitWidthRef = useRef(options.fitWidthPx);
  const scaleRef = useRef(options.scale);
  // Keep the latest callbacks/measurements in refs without writing them during
  // render (a render-unsafe pattern under concurrent React); an effect runs
  // before any pointer event the browser can deliver after commit.
  useEffect(() => {
    commitRef.current = options.commitTransform;
    fitWidthRef.current = options.fitWidthPx;
    scaleRef.current = options.scale;
  }, [options.commitTransform, options.fitWidthPx, options.scale]);

  // A slide change or a shrinking element set prunes ids that no longer exist;
  // the selection itself is per slide, so switching slides clears it.
  useEffect(() => {
    setSelectionState((current) => (current.ids.length === 0 ? current : pruneSelection(current, boxes)));
  }, [boxes]);
  useEffect(() => {
    setSelectionState(EMPTY_SELECTION);
    setGesture(null);
    setMarquee(null);
    marqueeStart.current = null;
    clickTarget.current = null;
  }, [slideIndex]);

  const bounds = useMemo(() => selectionBounds(boxes, selection.ids), [boxes, selection.ids]);
  const canDelete = Boolean(deleteElements) && selection.ids.length > 0;

  const clear = useCallback(() => setSelectionState(EMPTY_SELECTION), []);
  const select = useCallback((ids: readonly string[]) => {
    const live = new Set(boxes.filter((entry) => !entry.decoration && !entry.background).map((entry) => entry.sourceId));
    setSelectionState(setSelection(ids.filter((id) => live.has(id))));
  }, [boxes]);
  const selectAll = useCallback(() => {
    setSelectionState(setSelection(boxes.filter((entry) => !entry.decoration && !entry.background).map((entry) => entry.sourceId)));
  }, [boxes]);

  const deleteSelection = useCallback(() => {
    if (!deleteElements || selection.ids.length === 0) return;
    const ids = [...selection.ids];
    void Promise.resolve(deleteElements(slideIndex, ids))
      .then(() => {
        setSelectionState(EMPTY_SELECTION);
        onDeleteCommitted?.();
      })
      .catch((error: unknown) => onError?.(error));
  }, [deleteElements, onDeleteCommitted, onError, selection.ids, slideIndex]);

  const onPointerDown = useCallback((point: PptxPoint, additive: boolean) => {
    if (!interactive) return;
    const handle = gestureHandleAt(bounds, point, HANDLE_HIT_RADIUS_PX / Math.max(scaleRef.current, 0.01), page);
    if (handle && bounds) {
      const opened = beginGesture({ boxes, selectedIds: selection.ids, page }, point, handle);
      if (opened) setGesture(opened);
      return;
    }
    const hit = hitElement(boxes, point);
    if (hit === null) {
      // Empty canvas: start a marquee. A plain drag replaces the selection,
      // shift adds to it.
      marqueeStart.current = point;
      marqueeAdditive.current = additive;
      setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
      return;
    }
    if (additive) {
      // Shift-click only toggles membership; it never opens a drag.
      setSelectionState(selectAt(selection, hit, true));
      return;
    }
    if (selection.ids.includes(hit)) {
      // Pointer-down on an already-selected element drags the WHOLE selection;
      // a click that never moved collapses to this element on pointer-up.
      clickTarget.current = hit;
      const opened = beginGesture({ boxes, selectedIds: selection.ids, page }, point, null);
      if (opened) setGesture(opened);
      return;
    }
    const next = selectAt(selection, hit, false);
    setSelectionState(next);
    const opened = beginGesture({ boxes, selectedIds: next.ids, page }, point, null);
    if (opened) setGesture(opened);
  }, [bounds, boxes, interactive, page, selection]);

  const elementAt = useCallback((point: PptxPoint): string | null => hitElement(boxes, point), [boxes]);

  const onContextPointerDown = useCallback((point: PptxPoint) => {
    if (!interactive) return;
    // Chorded buttons: a right press while a left drag or marquee is open must not replace
    // the selection under it (the gesture commits against a snapshot of the old members).
    if (gesture || marqueeStart.current) return;
    const hit = hitElement(boxes, point);
    if (hit === null) {
      setSelectionState(EMPTY_SELECTION);
      return;
    }
    // Already part of the selection: keep the whole selection so the menu acts on it.
    if (selection.ids.includes(hit)) return;
    setSelectionState(setSelection([hit]));
  }, [boxes, gesture, interactive, selection.ids]);

  const onPointerMove = useCallback((point: PptxPoint, shiftKey: boolean) => {
    if (gesture) {
      setGesture(applyGesture(gesture, point, page, shiftKey));
      return;
    }
    const start = marqueeStart.current;
    if (start) setMarquee(normalizeRect(start, point));
  }, [gesture, page]);

  const onPointerUp = useCallback(() => {
    if (gesture) {
      setGesture(null);
      if (gestureIsNoop(gesture)) {
        // A click on one of several selected elements narrows to that element.
        const target = clickTarget.current;
        clickTarget.current = null;
        if (target) setSelectionState(setSelection([target]));
        return;
      }
      clickTarget.current = null;
      const requests = gestureCommitRequests(gesture, slideIndex, fitWidthRef.current);
      if (requests.length === 0) return;
      const commit = commitRef.current;
      const run = commit
        ? Promise.all(requests.map((request) => commit(request)))
        : Promise.reject(new Error("pptx_transform_unbound"));
      void run.catch((error: unknown) => onError?.(error));
      return;
    }
    const start = marqueeStart.current;
    const current = marquee;
    marqueeStart.current = null;
    setMarquee(null);
    if (!start || !current) return;
    const ids = marqueeSelection(boxes, current);
    setSelectionState((previous) => (marqueeAdditive.current ? setSelection([...previous.ids, ...ids]) : setSelection(ids)));
  }, [boxes, gesture, marquee, onError, slideIndex]);

  const onPointerCancel = useCallback(() => {
    marqueeStart.current = null;
    setMarquee(null);
    setGesture(null);
  }, []);

  // Only a gesture that actually moved draws previews: a pointer-down that is
  // still a click would otherwise paint dashed outlines over the selection.
  const previews = useMemo<readonly PptxSelectionPreviewBox[]>(
    () => (gesture && !gestureIsNoop(gesture) ? gesture.members.map((member) => ({ sourceId: member.sourceId, box: member.preview })) : []),
    [gesture],
  );

  return {
    selection,
    bounds,
    previews,
    marquee,
    canDelete,
    clear,
    select,
    selectAll,
    deleteSelection,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextPointerDown,
    elementAt,
  };
}
