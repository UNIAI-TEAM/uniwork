// UNI-940 X02 - the grid geometry seam the editor's visual overlay (charts,
// pictures, shapes drawn above the canvas) positions itself with. Univer's
// FRange.getCellRect is scene space: it includes the header offsets but never
// the scroll, and scene units scale by the sheet zoom on screen. So a cell's
// on-screen box is the main canvas origin plus (scene - viewport scroll) x
// zoom - the mapping genoffice's shape-draw.ts rectToAnchor uses. Boxes are
// returned relative to the renderer container, which is where the overlay is
// mounted. Frozen panes are not modelled (the overlay follows the main
// viewport only).
import type { IRange } from "@univerjs/core";
import { IRenderManagerService, SHEET_VIEWPORT_KEY } from "@univerjs/engine-render";
import { iconMap } from "@univerjs/preset-sheets-conditional-formatting";
import { toNeutralStyle } from "../../upstream/apps/sheets/src/renderer/edit-journal";
import type { UniverRuntime } from "../../upstream/apps/sheets/src/renderer/univer-state";

/** A cell's box in container pixels (zoom and scroll applied) plus the zoom
 *  the overlay converts unzoomed sheet pixels with. */
export interface XlsxRendererCellBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}

/** The cell under a container point, with the point's offset inside that
 *  cell in UNZOOMED sheet pixels (1 px = 9525 EMU at 96 dpi). */
export interface XlsxRendererCellHit {
  readonly row: number;
  readonly column: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Live values of a range on the active sheet (session edits included), as
 *  raw scalars and as the grid displays them. */
export interface XlsxRendererRangeValues {
  readonly values: readonly (readonly (string | number | boolean | null)[])[];
  readonly display: readonly (readonly string[])[];
}

/** A cell's composed style in the renderer-neutral wire shape. */
export type XlsxRendererCellStyle = NonNullable<ReturnType<typeof toNeutralStyle>>;

/** What the grid shows for a range of the active sheet, for print. Sizes are
 *  unzoomed sheet pixels; a hidden row/column includes filtered-out rows. */
export interface XlsxRendererPrintRange {
  readonly styles: readonly (readonly (XlsxRendererCellStyle | null)[])[];
  readonly rows: readonly { readonly height: number; readonly hidden: boolean }[];
  readonly columns: readonly { readonly width: number; readonly hidden: boolean }[];
  readonly merges: readonly IRange[];
  readonly marks: readonly XlsxRendererCellMark[];
}

/** UNI-952 D3: what a data bar or icon-set rule paints over one cell - the
 *  conditional-formatting view model's evaluated result the canvas extensions
 *  draw from (nothing is re-evaluated). `value` and `startPoint` are the
 *  painter's percentages; `icon` is the painter's own data: URL. */
export interface XlsxRendererCellMark {
  readonly row: number;
  readonly column: number;
  readonly dataBar?: { readonly color: string; readonly value: number; readonly startPoint: number; readonly isGradient: boolean };
  readonly icon?: string;
  /** The rule hides the cell's value ("show bar/icon only"). */
  readonly hideValue?: boolean;
}

interface CfCellData {
  readonly dataBar?: { color?: unknown; value?: unknown; startPoint?: unknown; isGradient?: unknown };
  readonly iconSet?: { iconType?: unknown; iconId?: unknown };
  readonly fontRenderExtension?: { isSkip?: unknown };
}

/** The data bar / icon a CF rule paints on a cell, or null. */
function markOf(row: number, column: number, cell: CfCellData | null | undefined): XlsxRendererCellMark | null {
  if (!cell) return null;
  const bar = cell.dataBar;
  const dataBar = bar && typeof bar.color === "string" && typeof bar.value === "number" && typeof bar.startPoint === "number"
    ? { color: bar.color, value: bar.value, startPoint: bar.startPoint, isGradient: bar.isGradient === true }
    : undefined;
  const set = cell.iconSet;
  const icons = set && typeof set.iconType === "string" ? (iconMap as Record<string, readonly string[] | undefined>)[set.iconType] : undefined;
  const icon = icons?.[Number(set?.iconId)];
  if (!dataBar && typeof icon !== "string") return null;
  return {
    row,
    column,
    ...(dataBar ? { dataBar } : {}),
    ...(typeof icon === "string" ? { icon } : {}),
    ...(cell.fontRenderExtension?.isSkip === true ? { hideValue: true } : {}),
  };
}

export interface XlsxRendererGeometry {
  getCellBox(sheetId: string, row: number, column: number): XlsxRendererCellBox | null;
  cellAtPoint(sheetId: string, x: number, y: number): XlsxRendererCellHit | null;
  readRangeValues(sheetId: string, range: IRange): XlsxRendererRangeValues | null;
  readPrintRange(sheetId: string, range: IRange): XlsxRendererPrintRange | null;
}

/** OOXML grid bounds; a walk never leaves them. */
const MAX_ROW = 1_048_575;
const MAX_COLUMN = 16_383;

export function createGridGeometry(runtime: UniverRuntime, container: HTMLElement): XlsxRendererGeometry {
  /** The active sheet when it is `sheetId` (geometry exists only for the
   *  sheet on screen), else null. */
  const activeSheet = (sheetId: string) => {
    const workbook = runtime.univerAPI.getActiveWorkbook();
    const worksheet = workbook?.getActiveSheet();
    if (!workbook || !worksheet || worksheet.getSheetId() !== sheetId) return null;
    return { workbook, worksheet };
  };

  /** The render surface: the largest canvas in the container (the grid). */
  const surfaceRect = (): DOMRect | null => {
    let surface: DOMRect | null = null;
    for (const canvas of container.querySelectorAll("canvas")) {
      const rect = canvas.getBoundingClientRect();
      if (!surface || rect.width * rect.height > surface.width * surface.height) surface = rect;
    }
    return surface;
  };

  const scrollOf = (unitId: string): { x: number; y: number } => {
    const viewMain = runtime.univer
      .__getInjector()
      .get(IRenderManagerService)
      .getRenderById(unitId)
      ?.scene?.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN);
    return { x: viewMain?.viewportScrollX ?? 0, y: viewMain?.viewportScrollY ?? 0 };
  };

  const getCellBox: XlsxRendererGeometry["getCellBox"] = (sheetId, row, column) => {
    const active = activeSheet(sheetId);
    const surface = surfaceRect();
    if (!active || !surface) return null;
    try {
      const cell = active.worksheet.getRange(row, column, 1, 1).getCellRect();
      const zoom = active.worksheet.getZoom() || 1;
      const scroll = scrollOf(active.workbook.getId());
      const origin = container.getBoundingClientRect();
      return {
        x: surface.x - origin.x + (cell.x - scroll.x) * zoom,
        y: surface.y - origin.y + (cell.y - scroll.y) * zoom,
        width: cell.width * zoom,
        height: cell.height * zoom,
        zoom,
      };
    } catch {
      return null;
    }
  };

  /** Walk one axis from a known cell edge to the cell holding `target`. */
  const walk = (start: number, startEdge: number, target: number, size: (index: number) => number, max: number, zoom: number) => {
    let index = start;
    let edge = startEdge;
    while (target < edge && index > 0) {
      index -= 1;
      edge -= size(index) * zoom;
    }
    while (index < max && target >= edge + size(index) * zoom) {
      edge += size(index) * zoom;
      index += 1;
    }
    return { index, offset: Math.max(0, (target - edge) / zoom) };
  };

  const cellAtPoint: XlsxRendererGeometry["cellAtPoint"] = (sheetId, x, y) => {
    const active = activeSheet(sheetId);
    if (!active) return null;
    const visible: IRange | null = active.worksheet.getVisibleRange();
    if (!visible) return null;
    const origin = getCellBox(sheetId, visible.startRow, visible.startColumn);
    if (!origin) return null;
    const columnWidth = (index: number) => Math.max(active.worksheet.getColumnWidth(index), 1);
    const rowHeight = (index: number) => Math.max(active.worksheet.getRowHeight(index), 1);
    const column = walk(visible.startColumn, origin.x, x, columnWidth, MAX_COLUMN, origin.zoom);
    const row = walk(visible.startRow, origin.y, y, rowHeight, MAX_ROW, origin.zoom);
    return { row: row.index, column: column.index, offsetX: column.offset, offsetY: row.offset };
  };

  const readRangeValues: XlsxRendererGeometry["readRangeValues"] = (sheetId, range) => {
    const active = activeSheet(sheetId);
    if (!active) return null;
    try {
      const target = active.worksheet.getRange(range.startRow, range.startColumn, range.endRow - range.startRow + 1, range.endColumn - range.startColumn + 1);
      const values = target.getValues().map((row) => row.map((value) => (value === undefined || value === null ? null : value as string | number | boolean)));
      return { values, display: target.getDisplayValues() };
    } catch {
      return null;
    }
  };

  const readPrintRange: XlsxRendererGeometry["readPrintRange"] = (sheetId, range) => {
    const active = activeSheet(sheetId);
    if (!active) return null;
    try {
      const sheet = active.worksheet.getSheet();
      const styles: (XlsxRendererCellStyle | null)[][] = [];
      const rows: { height: number; hidden: boolean }[] = [];
      const marks: XlsxRendererCellMark[] = [];
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        rows.push({ height: sheet.getRowHeight(row), hidden: !sheet.getRowVisible(row) || sheet.getRowFiltered(row) });
        const line: (XlsxRendererCellStyle | null)[] = [];
        for (let column = range.startColumn; column <= range.endColumn; column += 1) {
          // getCell runs the view-model interceptors (conditional formatting
          // among them), so the composed style is what the canvas paints.
          const cell = sheet.getCell(row, column);
          const composed = sheet.getComposedCellStyleByCellData(row, column, cell);
          line.push(toNeutralStyle(composed as Record<string, unknown>) ?? null);
          const mark = markOf(row, column, cell as unknown as CfCellData | null | undefined);
          if (mark) marks.push(mark);
        }
        styles.push(line);
      }
      const columns: { width: number; hidden: boolean }[] = [];
      for (let column = range.startColumn; column <= range.endColumn; column += 1) {
        columns.push({ width: sheet.getColumnWidth(column), hidden: !sheet.getColVisible(column) });
      }
      const merges = sheet.getMergeData().filter((merge) =>
        merge.startRow <= range.endRow && merge.endRow >= range.startRow && merge.startColumn <= range.endColumn && merge.endColumn >= range.startColumn);
      return { styles, rows, columns, merges: merges.map((merge) => ({ ...merge })), marks };
    } catch {
      return null;
    }
  };

  return { getCellBox, cellAtPoint, readRangeValues, readPrintRange };
}
