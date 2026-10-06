// UNI-940 X02 (B8): the editor-side model of the charts, pictures and shapes
// inserted this session - the overlay's state, the anchor <-> pixel math over
// the renderer's geometry seam, and the set_visual / remove_visual wire ops
// the engine persists (packages/office-engine/src/xlsx/ops-visuals.ts).
import type { XlsxVisualAnchor, XlsxVisualChart, XlsxVisualImage, XlsxVisualShape } from "@uniwork/office-engine/xlsx";

/** One inserted visual as the overlay holds it. `sheetId` is the grid id (a
 *  session rename keeps it); the op target resolves the live name on emission.
 *  `generation` is the editor dirty generation of its last emitted op: once a
 *  save covers it the visual is in the file and `saved` locks it (the save
 *  path has no edit for visuals already in the file). */
export interface XlsxEditorVisual {
  readonly id: string;
  readonly sheetId: string;
  readonly anchor: XlsxVisualAnchor;
  readonly chart?: XlsxVisualChart | undefined;
  readonly shape?: XlsxVisualShape | undefined;
  readonly image?: XlsxVisualImage | undefined;
  readonly generation: number;
  readonly saved: boolean;
}

/** A rectangle in container pixels. */
export interface XlsxVisualBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The renderer geometry seam (XlsxGridHandle.getCellBox / cellAtPoint). */
export interface XlsxVisualGeometry {
  getCellBox(sheetId: string, row: number, column: number): (XlsxVisualBox & { readonly zoom: number }) | null;
  cellAtPoint(sheetId: string, x: number, y: number): { row: number; column: number; offsetX: number; offsetY: number } | null;
}

/** DrawingML: 1 px at 96 dpi and 100% zoom = 9525 EMU. */
export const EMU_PER_PX = 9525;
/** Smallest box a drag or resize may leave, in container pixels. */
export const MIN_VISUAL_PX = 12;

/** The container box an anchor covers on screen; null when its sheet is not
 *  the one on screen (the renderer only measures the active sheet). */
export function boxFromAnchor(geometry: XlsxVisualGeometry, sheetId: string, anchor: XlsxVisualAnchor): XlsxVisualBox | null {
  const from = geometry.getCellBox(sheetId, anchor.fromRow, anchor.fromColumn);
  const to = geometry.getCellBox(sheetId, anchor.toRow, anchor.toColumn);
  if (!from || !to) return null;
  const x = from.x + (anchor.fromColumnOffset / EMU_PER_PX) * from.zoom;
  const y = from.y + (anchor.fromRowOffset / EMU_PER_PX) * from.zoom;
  const right = to.x + (anchor.toColumnOffset / EMU_PER_PX) * to.zoom;
  const bottom = to.y + (anchor.toRowOffset / EMU_PER_PX) * to.zoom;
  return { x, y, width: Math.max(right - x, 1), height: Math.max(bottom - y, 1) };
}

/** The two-cell anchor of a container box; null when a corner cannot be hit
 *  (sheet not on screen). An empty extent is widened by one pixel so the
 *  engine's "ends below and right" rule always holds. */
export function anchorFromBox(geometry: XlsxVisualGeometry, sheetId: string, box: XlsxVisualBox): XlsxVisualAnchor | null {
  const from = geometry.cellAtPoint(sheetId, box.x, box.y);
  const to = geometry.cellAtPoint(sheetId, box.x + Math.max(box.width, 1), box.y + Math.max(box.height, 1));
  if (!from || !to) return null;
  const emu = (px: number) => Math.max(0, Math.round(px * EMU_PER_PX));
  const anchor = {
    fromRow: from.row,
    fromColumn: from.column,
    fromRowOffset: emu(from.offsetY),
    fromColumnOffset: emu(from.offsetX),
    toRow: to.row,
    toColumn: to.column,
    toRowOffset: emu(to.offsetY),
    toColumnOffset: emu(to.offsetX),
  };
  if (anchor.toRow === anchor.fromRow && anchor.toRowOffset <= anchor.fromRowOffset) anchor.toRowOffset = anchor.fromRowOffset + EMU_PER_PX;
  if (anchor.toColumn === anchor.fromColumn && anchor.toColumnOffset <= anchor.fromColumnOffset) {
    anchor.toColumnOffset = anchor.fromColumnOffset + EMU_PER_PX;
  }
  return anchor;
}

/** The box a new visual takes: `width` x `height` unzoomed pixels whose top
 *  left sits on the given cell. */
export function insertBoxAt(
  geometry: XlsxVisualGeometry,
  sheetId: string,
  cell: { row: number; column: number },
  size: { width: number; height: number },
): XlsxVisualBox | null {
  const origin = geometry.getCellBox(sheetId, cell.row, cell.column);
  if (!origin) return null;
  return { x: origin.x, y: origin.y, width: size.width * origin.zoom, height: size.height * origin.zoom };
}

/** Keyboard nudge/resize of a box by `step` container pixels on one axis. */
export function nudgeBox(box: XlsxVisualBox, key: string, resize: boolean, step: number): XlsxVisualBox | null {
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  if (dx === 0 && dy === 0) return null;
  if (resize) {
    return { ...box, width: Math.max(MIN_VISUAL_PX, box.width + dx), height: Math.max(MIN_VISUAL_PX, box.height + dy) };
  }
  return { ...box, x: box.x + dx, y: box.y + dy };
}

/** A pointer drag applied to the box it started from: `handle` null moves,
 *  a corner ("nw" | "ne" | "sw" | "se") resizes from the opposite corner. */
export function dragBox(start: XlsxVisualBox, handle: XlsxVisualHandle | null, dx: number, dy: number): XlsxVisualBox {
  if (handle === null) return { ...start, x: start.x + dx, y: start.y + dy };
  const left = handle.includes("w") ? Math.min(start.x + dx, start.x + start.width - MIN_VISUAL_PX) : start.x;
  const top = handle.includes("n") ? Math.min(start.y + dy, start.y + start.height - MIN_VISUAL_PX) : start.y;
  const right = handle.includes("e") ? Math.max(start.x + start.width + dx, start.x + MIN_VISUAL_PX) : start.x + start.width;
  const bottom = handle.includes("s") ? Math.max(start.y + start.height + dy, start.y + MIN_VISUAL_PX) : start.y + start.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export type XlsxVisualHandle = "nw" | "ne" | "sw" | "se";

/** The set_visual wire op for one visual, targeted at its live sheet name. */
export function setVisualOp(visual: XlsxEditorVisual, sheetName: string): Record<string, unknown> {
  const body = visual.chart ? { chart: visual.chart } : visual.shape ? { shape: visual.shape } : { image: visual.image };
  return { op: "set_visual", target: { sheet: sheetName }, attributes: { id: visual.id, anchor: visual.anchor, ...body } };
}

export function removeVisualOp(visual: XlsxEditorVisual, sheetName: string): Record<string, unknown> {
  return { op: "remove_visual", target: { sheet: sheetName }, attributes: { id: visual.id } };
}

/** The visual's kind, for labels and test handles. */
export function visualKind(visual: Pick<XlsxEditorVisual, "chart" | "shape">): "chart" | "shape" | "picture" {
  return visual.chart ? "chart" : visual.shape ? "shape" : "picture";
}
