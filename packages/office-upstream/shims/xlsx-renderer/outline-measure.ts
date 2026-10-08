// UNI-964 - what the outline brackets measure on the grid: a line's box
// along its axis (the geometry seam, so scroll, zoom and frozen panes apply
// the way they do for the visual overlay), the panes on screen (the frozen
// band plus the scrolling pane, each with its line range and the pixels it
// covers) and a line's live hidden flag. A scrolling pane starts where the
// frozen band ends, or at the header edge without a freeze: a line partly
// scrolled under either is clipped there, never drawn over it.
import { IRenderManagerService, SHEET_VIEWPORT_KEY } from "@univerjs/engine-render";
import type { UniverRuntime } from "../../upstream/apps/sheets/src/renderer/univer-state";
import type { XlsxRendererGeometry } from "./geometry";
import type { OutlineMeasure, OutlinePane } from "./outline-brackets";
import type { OutlineAxis } from "./outline-levels";

export function createOutlineMeasure(runtime: UniverRuntime, geometry: XlsxRendererGeometry, sheetId: string): OutlineMeasure | null {
  const workbook = runtime.univerAPI.getActiveWorkbook();
  const worksheet = workbook?.getActiveSheet();
  if (!workbook || !worksheet || worksheet.getSheetId() !== sheetId) return null;
  const box = (axis: OutlineAxis, line: number): { start: number; size: number; zoom: number } | null => {
    const cell = axis === "rows" ? geometry.getCellBox(sheetId, line, 0) : geometry.getCellBox(sheetId, 0, line);
    if (!cell) return null;
    return axis === "rows" ? { start: cell.y, size: cell.height, zoom: cell.zoom } : { start: cell.x, size: cell.width, zoom: cell.zoom };
  };
  const panes: Record<OutlineAxis, OutlinePane[]> = { rows: [], cols: [] };
  let sheet: ReturnType<typeof worksheet.getSheet>;
  try {
    sheet = worksheet.getSheet();
    const visible = worksheet.getVisibleRange();
    const viewMain = runtime.univer.__getInjector().get(IRenderManagerService).getRenderById(workbook.getId())
      ?.scene?.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN);
    // Univer's freeze: ySplit rows ending before startRow (columns likewise).
    const freeze = worksheet.getFreeze?.();
    const axes = [
      { axis: "rows" as const, split: freeze?.ySplit ?? 0, from: freeze?.startRow ?? 0, scroll: viewMain?.viewportScrollY ?? 0,
        start: visible?.startRow, end: visible?.endRow },
      { axis: "cols" as const, split: freeze?.xSplit ?? 0, from: freeze?.startColumn ?? 0, scroll: viewMain?.viewportScrollX ?? 0,
        start: visible?.startColumn, end: visible?.endColumn },
    ];
    for (const { axis, split, from, scroll, start, end } of axes) {
      let edge: number | null = null;
      if (split > 0) {
        const band = { start: Math.max(0, from - split), end: Math.max(0, from - 1) };
        const first = box(axis, band.start);
        const last = box(axis, band.end);
        if (first && last) {
          edge = last.start + last.size;
          panes[axis].push({ ...band, from: first.start, to: edge });
        }
      } else {
        // The header edge: line 0's box with the scroll taken back off.
        const origin = box(axis, 0);
        if (origin) edge = origin.start + scroll * origin.zoom;
      }
      if (start === undefined || end === undefined || edge === null) continue;
      const first = split > 0 ? Math.max(start, from) : start;
      const last = box(axis, end);
      if (first <= end && last) panes[axis].push({ start: first, end, from: edge, to: last.start + last.size });
    }
  } catch {
    return null;
  }
  return {
    box(axis, line) {
      const measured = box(axis, line);
      return measured ? { start: measured.start, size: measured.size } : null;
    },
    visible: (axis) => panes[axis],
    isHidden: (axis, line) => axis === "rows" ? !sheet.getRowRawVisible(line) : !sheet.getColVisible(line),
  };
}
