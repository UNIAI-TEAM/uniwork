// UNI-940 X02 - the grid geometry seam the editor's visual overlay (charts,
// pictures, shapes drawn above the canvas) positions itself with. Univer's
// FRange.getCellRect is scene space: it includes the header offsets but never
// the scroll, and scene units scale by the sheet zoom on screen. So a cell's
// on-screen box is the main canvas origin plus (scene - viewport scroll) x
// zoom - the mapping genoffice's shape-draw.ts rectToAnchor uses. Boxes are
// returned relative to the renderer container, which is where the overlay is
// mounted. Frozen panes are modelled per axis. Univer's freeze is
// { xSplit, ySplit, startRow, startColumn }: ySplit rows are frozen and
// startRow is the first row of the scrolling viewport, so the frozen row band
// is [startRow - ySplit, startRow) (rows above it are scrolled out behind the
// band); columns likewise. A cell inside a band is drawn with the band's own
// scroll (its offset from row/column 0), and a point inside a band resolves by
// walking from the band's first row/column. Hidden rows and columns have size
// 0 in the walk.
import type { IRange } from "@univerjs/core";
import { IRenderManagerService, SHEET_VIEWPORT_KEY } from "@univerjs/engine-render";
import { iconMap } from "@univerjs/preset-sheets-conditional-formatting";
import type { toNeutralStyle } from "../../upstream/apps/sheets/src/renderer/edit-journal";
import type { UniverRuntime } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { printStyleOf } from "./print-style";

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

/** Univer command/operation/mutation ids (pinned @univerjs/sheets + sheets-ui)
 *  that can move or resize cells on screen: scroll, zoom, active sheet, row and
 *  column size/visibility, freeze, structural insert/remove and the selection
 *  moves that auto-scroll. */
const VIEWPORT_COMMAND_IDS: ReadonlySet<string> = new Set([
  "sheet.operation.set-scroll", "sheet.command.set-scroll-relative", "sheet.command.scroll-view",
  "sheet.command.scroll-view-reset", "sheet.command.scroll-to-cell", "sheet.operation.scroll-to-cell",
  "sheet.operation.scroll-to-range",
  "sheet.operation.set-zoom-ratio", "sheet.command.set-zoom-ratio", "sheet.command.change-zoom-ratio",
  "sheet.operation.set-worksheet-active", "sheet.command.set-worksheet-show", "sheet.command.insert-sheet",
  "sheet.command.remove-sheet", "sheet.mutation.insert-sheet", "sheet.mutation.remove-sheet",
  "sheet.command.set-row-height", "sheet.command.delta-row-height", "sheet.command.set-worksheet-col-width",
  "sheet.command.set-col-auto-width", "sheet.command.set-row-is-auto-height", "sheet.command.set-row-data",
  "sheet.command.set-col-data", "sheet.mutation.set-row-data", "sheet.mutation.set-col-data",
  "sheet.command.set-rows-hidden", "sheet.command.set-col-hidden", "sheet.command.set-col-visible-on-cols",
  "sheet.mutation.set-col-hidden", "sheet.mutation.set-col-visible",
  "sheet.command.hide-row-confirm", "sheet.command.hide-col-confirm",
  "sheet.command.set-row-frozen", "sheet.command.set-col-frozen",
  "sheet.command.insert-row-before", "sheet.command.insert-row-after", "sheet.command.insert-col-before",
  "sheet.command.insert-col-after", "sheet.command.insert-row-by-range", "sheet.command.insert-col-by-range",
  "sheet.command.insert-multi-rows-above", "sheet.command.insert-multi-rows-after",
  "sheet.command.insert-multi-cols-before", "sheet.command.insert-multi-cols-right",
  "sheet.command.remove-row-by-range", "sheet.command.remove-col-by-range",
  "sheet.command.remove-row-confirm", "sheet.command.remove-col-confirm",
  "sheet.mutation.insert-row", "sheet.mutation.insert-col", "sheet.mutation.remove-rows", "sheet.mutation.remove-col",
  "sheet.command.set-worksheet-row-count", "sheet.command.set-worksheet-column-count",
  "sheet.command.move-selection", "sheet.command.move-selection-enter-tab",
]);

/** Fallback for ids a later Univer adds (and the row auto-height mutations a
 *  cell edit fires): anything that scrolls, zooms, freezes, resizes or
 *  hides rows or columns still counts. */
const VIEWPORT_COMMAND_PATTERN = /scroll|zoom|frozen|freeze|row-height|col-width|auto-height|hidden|visible/i;

/** True when a executed command can change where a cell is drawn, so the
 *  visual overlay must re-measure; every other command leaves the layout. */
export function commandMovesCells(commandId: unknown): boolean {
  if (typeof commandId !== "string") return false;
  return VIEWPORT_COMMAND_IDS.has(commandId) || VIEWPORT_COMMAND_PATTERN.test(commandId);
}

/** OOXML grid bounds; a walk never leaves them. */
const MAX_ROW = 1_048_575;
const MAX_COLUMN = 16_383;

/** A frozen band: indexes [start, end). */
interface FrozenBand {
  readonly start: number;
  readonly end: number;
}

type ActiveWorksheet = NonNullable<ReturnType<ReturnType<UniverRuntime["univerAPI"]["getActiveWorkbook"]>["getActiveSheet"]>>;

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

  /** The frozen band per axis as a half-open index range; empty (start ==
   *  end) when the sheet has no freeze. The band is [start - split, start). */
  const freezeOf = (worksheet: ActiveWorksheet): { rows: FrozenBand; columns: FrozenBand } => {
    const none: FrozenBand = { start: 0, end: 0 };
    const band = (split: unknown, start: unknown): FrozenBand => {
      if (typeof split !== "number" || split <= 0) return none;
      if (typeof start === "number" && start >= split) return { start: start - split, end: start };
      return { start: 0, end: split };
    };
    try {
      const freeze = worksheet.getFreeze?.();
      if (freeze) return { rows: band(freeze.ySplit, freeze.startRow), columns: band(freeze.xSplit, freeze.startColumn) };
    } catch { /* fall through to the count accessors */ }
    try {
      const rows = worksheet.getFrozenRows?.();
      const columns = worksheet.getFrozenColumns?.();
      return { rows: band(rows, 0), columns: band(columns, 0) };
    } catch {
      return { rows: none, columns: none };
    }
  };

  /** Hidden rows/columns occupy no space; unknown visibility reads as visible. */
  const isHidden = (worksheet: ActiveWorksheet, axis: "row" | "column", index: number): boolean => {
    try {
      const sheet = worksheet.getSheet?.();
      if (!sheet) return false;
      const visible = axis === "row" ? sheet.getRowVisible?.(index) : sheet.getColVisible?.(index);
      return visible === false;
    } catch {
      return false;
    }
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
      const frozen = freezeOf(active.worksheet);
      // A band cell moves with the band's own scroll: its distance from row/column 0.
      const inRows = row >= frozen.rows.start && row < frozen.rows.end;
      const inColumns = column >= frozen.columns.start && column < frozen.columns.end;
      const bandY = inRows && frozen.rows.start > 0
        ? active.worksheet.getRange(frozen.rows.start, column, 1, 1).getCellRect().y - active.worksheet.getRange(0, column, 1, 1).getCellRect().y
        : 0;
      const bandX = inColumns && frozen.columns.start > 0
        ? active.worksheet.getRange(row, frozen.columns.start, 1, 1).getCellRect().x - active.worksheet.getRange(row, 0, 1, 1).getCellRect().x
        : 0;
      return {
        x: surface.x - origin.x + (cell.x - (inColumns ? bandX : scroll.x)) * zoom,
        y: surface.y - origin.y + (cell.y - (inRows ? bandY : scroll.y)) * zoom,
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
    const frozen = freezeOf(active.worksheet);
    const columnWidth = (index: number) => (isHidden(active.worksheet, "column", index) ? 0 : Math.max(active.worksheet.getColumnWidth(index), 1));
    const rowHeight = (index: number) => (isHidden(active.worksheet, "row", index) ? 0 : Math.max(active.worksheet.getRowHeight(index), 1));
    // A point inside the frozen band starts at the band's first index at that
    // cell's box edge; the far edge of the band is the last band cell's edge.
    let columnStart = { index: visible.startColumn, edge: origin.x };
    if (frozen.columns.end > frozen.columns.start) {
      const first = getCellBox(sheetId, 0, frozen.columns.start);
      const last = getCellBox(sheetId, 0, frozen.columns.end - 1);
      if (first && last && x < last.x + last.width) columnStart = { index: frozen.columns.start, edge: first.x };
    }
    let rowStart = { index: visible.startRow, edge: origin.y };
    if (frozen.rows.end > frozen.rows.start) {
      const first = getCellBox(sheetId, frozen.rows.start, 0);
      const last = getCellBox(sheetId, frozen.rows.end - 1, 0);
      if (first && last && y < last.y + last.height) rowStart = { index: frozen.rows.start, edge: first.y };
    }
    const column = walk(columnStart.index, columnStart.edge, x, columnWidth, MAX_COLUMN, origin.zoom);
    const row = walk(rowStart.index, rowStart.edge, y, rowHeight, MAX_ROW, origin.zoom);
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
          line.push(printStyleOf(composed as Record<string, unknown>));
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
