// UNI-964 - what the outline brackets measure on the grid: a line's box
// along its axis (the geometry seam, so scroll, zoom and frozen panes apply
// the way they do for the visual overlay), the line ranges on screen (the
// frozen band plus the scrolling pane) and a line's live hidden flag.
import type { UniverRuntime } from "../../upstream/apps/sheets/src/renderer/univer-state";
import type { XlsxRendererGeometry } from "./geometry";
import type { OutlineMeasure } from "./outline-brackets";

export function createOutlineMeasure(runtime: UniverRuntime, geometry: XlsxRendererGeometry, sheetId: string): OutlineMeasure | null {
  const worksheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet();
  if (!worksheet || worksheet.getSheetId() !== sheetId) return null;
  const windows = { rows: [] as Array<{ start: number; end: number }>, cols: [] as Array<{ start: number; end: number }> };
  let sheet: ReturnType<typeof worksheet.getSheet>;
  try {
    sheet = worksheet.getSheet();
    const visible = worksheet.getVisibleRange();
    if (visible) {
      windows.rows.push({ start: visible.startRow, end: visible.endRow });
      windows.cols.push({ start: visible.startColumn, end: visible.endColumn });
    }
    // Univer's freeze: ySplit rows ending before startRow (columns likewise).
    const freeze = worksheet.getFreeze?.();
    if (freeze && freeze.ySplit > 0) windows.rows.push({ start: Math.max(0, freeze.startRow - freeze.ySplit), end: Math.max(0, freeze.startRow - 1) });
    if (freeze && freeze.xSplit > 0) windows.cols.push({ start: Math.max(0, freeze.startColumn - freeze.xSplit), end: Math.max(0, freeze.startColumn - 1) });
  } catch {
    return null;
  }
  return {
    box(axis, line) {
      const box = axis === "rows" ? geometry.getCellBox(sheetId, line, 0) : geometry.getCellBox(sheetId, 0, line);
      if (!box) return null;
      return axis === "rows" ? { start: box.y, size: box.height } : { start: box.x, size: box.width };
    },
    visible: (axis) => windows[axis],
    isHidden: (axis, line) => axis === "rows" ? !sheet.getRowRawVisible(line) : !sheet.getColVisible(line),
  };
}
