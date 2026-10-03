/**
 * Selection geometry: marquee hit-testing and the move / 8-handle resize /
 * rotate math behind the drag handles.
 *
 * All of it is pure page-px arithmetic over `PptxNodeBox` boxes (the seam P0-2
 * exposes through `collectRenderNodeBoxes`), so the same numbers a drag uses
 * are the numbers the unit tests pin. px -> EMU conversion stays in the engine
 * model (`makePxToEmu`, `EMU_PER_PX_96`); this module never writes a deck.
 */
import type { PptxNodeBox } from "../canvas/render-tree";

export interface PptxPoint {
  x: number;
  y: number;
}

export interface PptxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PptxHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

/** The eight resize handles plus the rotate grip, in paint order. */
export const PPTX_RESIZE_HANDLES: readonly Exclude<PptxHandleId, "rotate">[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** Smallest box a resize may produce, in page px. */
export const PPTX_MIN_BOX_PX = 1;

export interface PptxMarquee {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalise a drag's start/current point into a non-negative rectangle. */
export function normalizeRect(start: PptxPoint, current: PptxPoint): PptxMarquee {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return { x, y, w: Math.abs(current.x - start.x), h: Math.abs(current.y - start.y) };
}

export function rectsIntersect(a: PptxBox, b: PptxBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Marquee selection: every non-decoration, non-background node whose absolute
 * page box intersects the marquee. Decoration/background chrome is never
 * selectable, matching the canvas' own flags.
 */
export function marqueeSelection(boxes: readonly PptxNodeBox[], marquee: PptxMarquee): string[] {
  return boxes
    .filter((entry) => !entry.decoration && !entry.background)
    .filter((entry) => rectsIntersect(entry.box, marquee))
    .map((entry) => entry.sourceId);
}

/** Bounding box of one or more element boxes (null when none match). */
export function unionBox(boxes: readonly PptxBox[]): PptxBox | null {
  if (boxes.length === 0) return null;
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

/** Selection bounds for the given ids (null when none of them is on the slide). */
export function selectionBounds(boxes: readonly PptxNodeBox[], ids: readonly string[]): PptxBox | null {
  const wanted = new Set(ids);
  return unionBox(boxes.filter((entry) => wanted.has(entry.sourceId)).map((entry) => entry.box));
}

/** Handle positions on a box, page px. `n`/`s`/`e`/`w` sit on the edge midpoints. */
export function handlePosition(box: PptxBox, handle: Exclude<PptxHandleId, "rotate">): PptxPoint {
  const midX = box.x + box.w / 2;
  const midY = box.y + box.h / 2;
  switch (handle) {
    case "nw": return { x: box.x, y: box.y };
    case "n": return { x: midX, y: box.y };
    case "ne": return { x: box.x + box.w, y: box.y };
    case "e": return { x: box.x + box.w, y: midY };
    case "se": return { x: box.x + box.w, y: box.y + box.h };
    case "s": return { x: midX, y: box.y + box.h };
    case "sw": return { x: box.x, y: box.y + box.h };
    case "w": return { x: box.x, y: midY };
  }
}

/** Rotate grip, a fixed offset above the top edge. */
export function rotateHandlePosition(box: PptxBox, offsetPx = 24): PptxPoint {
  return { x: box.x + box.w / 2, y: box.y - offsetPx };
}

function clampMin(value: number): number {
  return Math.max(PPTX_MIN_BOX_PX, value);
}

/**
 * Move: translate by the drag delta, clamped so the box keeps a sliver on the
 * page (the engine would otherwise accept a fully off-page box).
 */
export function moveBox(box: PptxBox, delta: PptxPoint, page: { widthPx: number; heightPx: number }): PptxBox {
  const x = Math.min(Math.max(box.x + delta.x, -box.w + PPTX_MIN_BOX_PX), page.widthPx - PPTX_MIN_BOX_PX);
  const y = Math.min(Math.max(box.y + delta.y, -box.h + PPTX_MIN_BOX_PX), page.heightPx - PPTX_MIN_BOX_PX);
  return { x, y, w: box.w, h: box.h };
}

/**
 * Resize: drag one handle by the pointer delta. Opposite edges stay put; a
 * handle that would invert the box clamps at PPTX_MIN_BOX_PX instead of
 * flipping it (OOXML `cx`/`cy` must stay positive).
 */
export function resizeBox(box: PptxBox, handle: Exclude<PptxHandleId, "rotate">, delta: PptxPoint): PptxBox {
  let { x, y, w, h } = box;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("w")) {
    const nextX = Math.min(x + delta.x, right - PPTX_MIN_BOX_PX);
    w = right - nextX;
    x = nextX;
  }
  if (handle.includes("e")) w = clampMin(w + delta.x);
  if (handle.includes("n")) {
    const nextY = Math.min(y + delta.y, bottom - PPTX_MIN_BOX_PX);
    h = bottom - nextY;
    y = nextY;
  }
  if (handle.includes("s")) h = clampMin(h + delta.y);
  return { x, y, w, h };
}

/**
 * Rotate: the pointer angle around the box centre, in degrees, normalised to
 * 0..360. `shiftKey` snaps to 15-degree stops the way the desktop editors do.
 */
export function rotateDegrees(center: PptxPoint, pointer: PptxPoint, shiftKey = false): number {
  const raw = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  const normalized = ((raw % 360) + 360) % 360;
  return shiftKey ? Math.round(normalized / 15) * 15 % 360 : Math.round(normalized * 10) / 10;
}

/**
 * One selected element's new page box after a group gesture. The gesture runs
 * on the selection bounds; every member keeps its offset inside those bounds,
 * scaled by the bounds' resize factor, and every member takes the group's
 * rotation delta.
 */
export function transformWithinBounds(
  member: PptxBox,
  before: PptxBox,
  after: PptxBox,
  rotationDeltaDeg: number,
): PptxBox & { rotationDeg: number } {
  const scaleX = before.w > 0 ? after.w / before.w : 1;
  const scaleY = before.h > 0 ? after.h / before.h : 1;
  return {
    x: after.x + (member.x - before.x) * scaleX,
    y: after.y + (member.y - before.y) * scaleY,
    w: clampMin(member.w * scaleX),
    h: clampMin(member.h * scaleY),
    rotationDeg: rotationDeltaDeg,
  };
}

/** Handle under a pointer, page px, with a square hit radius. */
export function hitHandle(
  bounds: PptxBox,
  pointer: PptxPoint,
  radiusPx = 6,
  rotateOffsetPx = 24,
): PptxHandleId | null {
  const rotate = rotateHandlePosition(bounds, rotateOffsetPx);
  if (Math.abs(pointer.x - rotate.x) <= radiusPx && Math.abs(pointer.y - rotate.y) <= radiusPx) return "rotate";
  for (const handle of PPTX_RESIZE_HANDLES) {
    const point = handlePosition(bounds, handle);
    if (Math.abs(pointer.x - point.x) <= radiusPx && Math.abs(pointer.y - point.y) <= radiusPx) return handle;
  }
  return null;
}

/** Topmost element under a page point (later nodes paint on top). */
export function hitElement(boxes: readonly PptxNodeBox[], pointer: PptxPoint): string | null {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const entry = boxes[index]!;
    if (entry.decoration || entry.background) continue;
    const { box } = entry;
    if (pointer.x >= box.x && pointer.x <= box.x + box.w && pointer.y >= box.y && pointer.y <= box.y + box.h) {
      return entry.sourceId;
    }
  }
  return null;
}
