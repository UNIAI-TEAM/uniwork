/**
 * One drag gesture, start to finish, as pure data.
 *
 * A gesture is opened once on pointer-down, mutated by pointer-move (which only
 * recomputes a preview — no engine call), and closed once on pointer-up with
 * exactly one commit payload per selected element. That "one commit per
 * gesture, never one per mousemove" rule is enforced here rather than in the
 * component, so it is unit-testable.
 */
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import type { PptxNodeBox } from "../canvas/render-tree";
import {
  hitHandle,
  moveBox,
  resizeBox,
  rotateDegrees,
  transformWithinBounds,
  type PptxBox,
  type PptxHandleId,
  type PptxPoint,
} from "./geometry";

export type PptxGestureKind = "move" | "resize" | "rotate";

/** A member's live preview: the page box plus the rotation the gesture applied. */
export type PptxPreviewBox = PptxBox & { rotationDeg?: number };

/** A member's page box plus the rotation it already had when the gesture opened.
 *  `PptxPlacedBox.rotationDeg` reaches every box through `collectRenderNodeBoxes`, so
 *  the gesture carries the element's real angle instead of assuming 0. */
type PptxGestureBox = PptxBox & { rotationDeg: number };

export interface PptxGestureMember {
  sourceId: string;
  /** Page box + existing rotation when the gesture opened. */
  before: PptxGestureBox;
  /** Current preview page box (the drag's live feedback). */
  preview: PptxPreviewBox;
}

export interface PptxGesture {
  kind: PptxGestureKind;
  handle: PptxHandleId | null;
  start: PptxPoint;
  /** Union bounds of the selection when the gesture opened. */
  bounds: PptxBox;
  members: readonly PptxGestureMember[];
  rotationDeltaDeg: number;
}

export interface PptxGestureContext {
  boxes: readonly PptxNodeBox[];
  selectedIds: readonly string[];
  page: { widthPx: number; heightPx: number };
}

/** Open a gesture on the current selection. Null when nothing is selected. */
export function beginGesture(context: PptxGestureContext, point: PptxPoint, handle: PptxHandleId | null): PptxGesture | null {
  const wanted = new Set(context.selectedIds);
  const members = context.boxes
    .filter((entry) => wanted.has(entry.sourceId))
    .map((entry) => ({ sourceId: entry.sourceId, before: { ...entry.box }, preview: { ...entry.box } as PptxPreviewBox }));
  if (members.length === 0) return null;
  const bounds = unionOf(members.map((member) => member.before));
  return {
    kind: handle === null ? "move" : handle === "rotate" ? "rotate" : "resize",
    handle,
    start: point,
    bounds,
    members,
    rotationDeltaDeg: 0,
  };
}

/** Recompute the preview for a pointer position. Pure: returns a new gesture. */
export function applyGesture(gesture: PptxGesture, point: PptxPoint, page: { widthPx: number; heightPx: number }, shiftKey = false): PptxGesture {
  const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y };
  if (gesture.kind === "move") {
    const moved = moveBox(gesture.bounds, delta, page);
    const offset = { x: moved.x - gesture.bounds.x, y: moved.y - gesture.bounds.y };
    return {
      ...gesture,
      members: gesture.members.map((member) => ({
        ...member,
        preview: { x: member.before.x + offset.x, y: member.before.y + offset.y, w: member.before.w, h: member.before.h },
      })),
    };
  }
  if (gesture.kind === "resize") {
    const resized = resizeBox(gesture.bounds, gesture.handle as Exclude<PptxHandleId, "rotate">, delta);
    return {
      ...gesture,
      members: gesture.members.map((member) => ({
        ...member,
        preview: transformWithinBounds(member.before, gesture.bounds, resized, 0),
      })),
    };
  }
  const center = { x: gesture.bounds.x + gesture.bounds.w / 2, y: gesture.bounds.y + gesture.bounds.h / 2 };
  const rotationDeltaDeg = rotateDegrees(center, point, shiftKey);
  return {
    ...gesture,
    rotationDeltaDeg,
    members: gesture.members.map((member) => ({
      ...member,
      preview: transformWithinBounds(member.before, gesture.bounds, gesture.bounds, rotationDeltaDeg),
    })),
  };
}

/**
 * Commit payload: one transform request per selected element, in selection
 * order, computed from the live preview. Callers send this exactly once, on
 * pointer-up — never per move.
 */
export function gestureCommitRequests(
  gesture: PptxGesture,
  slideIndex: number,
  fitWidthPx: number,
): SlidesEditTransformRequest[] {
  return gesture.members.map((member) => ({
    slideIndex,
    sourceId: member.sourceId,
    xPx: round(member.preview.x),
    yPx: round(member.preview.y),
    wPx: round(Math.max(1, member.preview.w)),
    hPx: round(Math.max(1, member.preview.h)),
    // The channel writes an ABSOLUTE angle: a move/resize keeps the element's own
    // rotation, a rotate adds the gesture delta to it. Writing the raw delta here
    // silently reset every rotated shape to 0 on the most common gestures.
    rotationDeg: round(gesture.kind === "rotate" ? member.before.rotationDeg + gesture.rotationDeltaDeg : member.before.rotationDeg),
    fitWidthPx,
  }));
}

/**
 * A gesture that never moved (a plain click that opened a move) must not
 * commit: "one edit per gesture" only counts gestures that actually changed
 * something.
 */
export function gestureIsNoop(gesture: PptxGesture): boolean {
  if (gesture.rotationDeltaDeg !== 0) return false;
  return gesture.members.every((member) =>
    member.preview.x === member.before.x &&
    member.preview.y === member.before.y &&
    member.preview.w === member.before.w &&
    member.preview.h === member.before.h,
  );
}

/** Handle under the pointer, given the current selection bounds. `radiusPx` is in
 * page px, so the caller divides its on-screen hit radius by the zoom. */
export function gestureHandleAt(
  bounds: PptxBox | null,
  point: PptxPoint,
  radiusPx = 6,
  page?: { widthPx: number; heightPx: number },
): PptxHandleId | null {
  return bounds ? hitHandle(bounds, point, radiusPx, 24, page) : null;
}

function unionOf(boxes: readonly PptxBox[]): PptxBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
