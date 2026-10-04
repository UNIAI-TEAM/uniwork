/**
 * Pure geometry for the H6 float toolbar.
 *
 * The toolbar anchors to the same canvas-space box the H5 outline paints: the
 * inspector's rect is in the frame's INTERNAL viewport px, the shell renders
 * that frame's content scaled by `clampedZoom/100`, and in split mode the frame
 * does not start at the canvas origin. The box is therefore
 * `frameOffset + zoom * rect`, and the toolbar sits centred just above it (or
 * below when the box is too close to the canvas top to fit).
 *
 * Nothing here touches the DOM, React or the document: the component probes
 * layout and hands the numbers in, so every branch below is unit-testable.
 */
import { clampZoom } from "../shell-model";
import type { HtmlSelection, HtmlSelectionRect } from "../selection/model";

/** Space between the selection box and the toolbar. */
export const FLOAT_TOOLBAR_GAP = 8;

/** Smallest toolbar height the "does it fit above?" test assumes. Kept as a
 * constant so the decision does not depend on a measurement that is zero in
 * jsdom and async in the browser. */
export const FLOAT_TOOLBAR_MIN_HEIGHT = 36;

/** Mirrors the H5 model's own bound: an overlay can never be asked to paint
 * outside it, so a rect that arrives already clamped stays put. */
const FLOAT_MAX = 10_000_000;

export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HtmlFloatAnchor {
  /** Canvas-space x of the toolbar's centre (the element is translated -50%). */
  left: number;
  /** Canvas-space y of the toolbar's anchored edge. */
  top: number;
  /** Which side of the selection the toolbar sits on. */
  placement: "above" | "below";
}

function clampCoord(value: number): number {
  return Math.min(FLOAT_MAX, Math.max(-FLOAT_MAX, value));
}

/**
 * The selection's rect, or null when there is nothing the toolbar can anchor
 * to. The H5 model already validates and clamps every rect, so this is a
 * second, cheap guard for the two cases the toolbar must never paint from: a
 * missing rect, and a non-finite or zero-size one (a caret has no box to sit
 * above). Malformed input degrades to "no toolbar", never to a NaN style.
 */
export function renderableRect(selection: HtmlSelection | null): HtmlSelectionRect | null {
  if (selection === null) return null;
  const rect = selection.rect;
  if (rect === null) return null;
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

/** The selection's canvas-space box: `offset + zoom * rect`. Identical to the
 * math the H5 outline uses, so the two never drift apart. */
export function selectionBox(rect: HtmlSelectionRect, offset: { x: number; y: number }, zoomPercent: number): CanvasBox {
  const scale = clampZoom(zoomPercent) / 100;
  return {
    left: clampCoord(offset.x + scale * rect.x),
    top: clampCoord(offset.y + scale * rect.y),
    width: Math.max(0, scale * rect.width),
    height: Math.max(0, scale * rect.height),
  };
}

/** Where the toolbar's box sits relative to the selection box. */
export function floatAnchor(box: CanvasBox): HtmlFloatAnchor {
  const left = clampCoord(box.left + box.width / 2);
  const fitsAbove = box.top - FLOAT_TOOLBAR_GAP - FLOAT_TOOLBAR_MIN_HEIGHT >= 0;
  const top = fitsAbove ? box.top - FLOAT_TOOLBAR_GAP : box.top + box.height + FLOAT_TOOLBAR_GAP;
  return { left, top: clampCoord(top), placement: fitsAbove ? "above" : "below" };
}
