// UNI-953 X02 r2: the drawn visuals (file-native and session) as a positioned
// image list for print (L1). Positions are sheet pixels at 100% zoom from the
// top-left of cell A1, derived from the anchor with per-sheet row/column
// sizes; the image is an SVG string for charts and shapes (the overlay's own
// renderer, token classes + currentColor, so it prints inside the app's
// stylesheet) and a data URL for pictures. Read-only: nothing here edits.
import { renderToStaticMarkup } from "react-dom/server";
import type { XlsxVisualAnchor, XlsxVisualImageType } from "@uniwork/office-engine/xlsx";
import { XlsxVisualChartSvg } from "./visual-chart-svg";
import { XlsxVisualShapeSvg } from "./visual-shape-svg";
import { EMU_PER_PX, visualKind, type XlsxEditorVisual, type XlsxVisualBox, type XlsxVisualGeometry } from "./visual-model";

/** Row and column sizes of one sheet in px at 100% zoom (hidden = 0). */
export interface XlsxPrintSheetMetrics {
  columnWidth(column: number): number;
  rowHeight(row: number): number;
}

type XlsxPrintableImage =
  | { readonly type: "svg"; readonly svg: string }
  | { readonly type: "dataUrl"; readonly mediaType: XlsxVisualImageType; readonly dataUrl: string };

/** One drawn visual, positioned for print. */
export interface XlsxPrintableVisual {
  readonly sheetId: string;
  readonly sheetName: string;
  readonly kind: "chart" | "picture" | "shape";
  /** Paint order on its sheet, back to front (0 first). */
  readonly zIndex: number;
  /** The cell anchor: 0-based cells plus EMU offsets (9525 EMU = 1 px). */
  readonly anchor: XlsxVisualAnchor;
  /** Sheet px at 100% zoom from A1's top-left; null without sizes for the sheet. */
  readonly box: XlsxVisualBox | null;
  /** null: a chart type or picture with no preview (print a frame with `title`). */
  readonly image: XlsxPrintableImage | null;
  /** The chart or picture title, else the localized kind (print's alt text and frame label). */
  readonly title: string;
}

/** Sizes read from the live grid: each cell box's own width/height is
 *  scroll- and freeze-independent, so dividing by zoom gives 100% px. Only
 *  the sheet on screen can be measured. */
export function gridSheetMetrics(geometry: XlsxVisualGeometry, sheetId: string): XlsxPrintSheetMetrics | null {
  const probe = geometry.getCellBox(sheetId, 0, 0);
  if (!probe) return null;
  const columns = new Map<number, number>();
  const rows = new Map<number, number>();
  const size = (cache: Map<number, number>, index: number, read: () => number) => {
    if (!cache.has(index)) cache.set(index, read());
    return cache.get(index)!;
  };
  return {
    columnWidth: (column) => size(columns, column, () => {
      const box = geometry.getCellBox(sheetId, 0, column);
      return box ? box.width / box.zoom : 0;
    }),
    rowHeight: (row) => size(rows, row, () => {
      const box = geometry.getCellBox(sheetId, row, 0);
      return box ? box.height / box.zoom : 0;
    }),
  };
}

const sum = (count: number, size: (index: number) => number) => {
  let total = 0;
  for (let index = 0; index < count; index += 1) total += size(index);
  return total;
};

/** The visual's box in sheet px at 100% zoom. */
export function printBox(visual: XlsxEditorVisual, metrics: XlsxPrintSheetMetrics): XlsxVisualBox {
  const px = (emu: number) => emu / EMU_PER_PX;
  if (visual.position && visual.extent) {
    return { x: px(visual.position.x), y: px(visual.position.y), width: px(visual.extent.cx), height: px(visual.extent.cy) };
  }
  const { anchor } = visual;
  const x = sum(anchor.fromColumn, metrics.columnWidth) + px(anchor.fromColumnOffset);
  const y = sum(anchor.fromRow, metrics.rowHeight) + px(anchor.fromRowOffset);
  if (visual.extent) return { x, y, width: px(visual.extent.cx), height: px(visual.extent.cy) };
  const right = sum(anchor.toColumn, metrics.columnWidth) + px(anchor.toColumnOffset);
  const bottom = sum(anchor.toRow, metrics.rowHeight) + px(anchor.toRowOffset);
  return { x, y, width: Math.max(right - x, 0), height: Math.max(bottom - y, 0) };
}

function printImage(visual: XlsxEditorVisual, box: XlsxVisualBox | null, label: string): XlsxPrintableImage | null {
  const width = Math.max(box?.width ?? 0, 1);
  const height = Math.max(box?.height ?? 0, 1);
  if (visual.chart) return { type: "svg", svg: renderToStaticMarkup(<XlsxVisualChartSvg chart={visual.chart} width={width} height={height} label={label} />) };
  if (visual.shape) return { type: "svg", svg: renderToStaticMarkup(<XlsxVisualShapeSvg shape={visual.shape} width={width} height={height} />) };
  if (visual.image) return { type: "dataUrl", mediaType: visual.image.mediaType, dataUrl: `data:${visual.image.mediaType};base64,${visual.image.base64}` };
  return null;
}

/** The drawn visuals of one sheet (or every sheet), in paint order. */
export function printableVisuals(
  visuals: readonly XlsxEditorVisual[],
  sheets: readonly { readonly id: string; readonly name: string }[],
  metricsFor: (sheetId: string) => XlsxPrintSheetMetrics | null,
  kindLabel: (kind: XlsxPrintableVisual["kind"]) => string,
  sheetId?: string,
): XlsxPrintableVisual[] {
  const out: XlsxPrintableVisual[] = [];
  const order = new Map<string, number>();
  for (const visual of visuals) {
    if (visual.kind === "other" || (sheetId !== undefined && visual.sheetId !== sheetId)) continue;
    const sheet = sheets.find((candidate) => candidate.id === visual.sheetId);
    if (!sheet) continue;
    const zIndex = order.get(visual.sheetId) ?? 0;
    order.set(visual.sheetId, zIndex + 1);
    const metrics = metricsFor(visual.sheetId);
    const box = metrics ? printBox(visual, metrics) : null;
    const title = visual.chart?.title || visual.title || kindLabel(visualKind(visual));
    // Rendered on first read: print lists anchors and boxes for its range
    // without drawing anything, then draws each image once (review m3).
    let image: XlsxPrintableImage | null | undefined;
    out.push({
      sheetId: visual.sheetId,
      sheetName: sheet.name,
      kind: visualKind(visual),
      zIndex,
      anchor: visual.anchor,
      box,
      get image() {
        if (image === undefined) image = printImage(visual, box, title);
        return image;
      },
      title,
    });
  }
  return out;
}
