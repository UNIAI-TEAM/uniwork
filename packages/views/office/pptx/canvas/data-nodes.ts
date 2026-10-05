/**
 * SVG content for the "computed primitive" node families: tables, charts and placeholder
 * chips. pptx-render hands these over as ready-to-draw data (cell boxes, chart-space rects,
 * arcs), so the mapping is mechanical: no layout decisions happen here.
 */
import { fillPaint, normalizeColor, strokePaint, type PptxPaintContext } from "./paint";
import type { PptxChartRenderNode, PptxChipRenderNode, PptxTableRenderNode } from "./render-tree";
import { px, svgEl, svgText, type SvgAttrValue, type SvgNode } from "./svg-node";
import { displayFontFamily, textBlockPaint } from "./text";

interface DataNodeContext {
  ctx: PptxPaintContext;
  /** Page-space offset of the node (pattern/fill phase anchoring). */
  origin: { x: number; y: number };
  /** Counter-flip for glyphs when the table (or an ancestor) mirrors. */
  mirror?: { w: number; h: number; flipX: boolean; flipY: boolean };
}

function cellBorder(side: "l" | "r" | "t" | "b", cell: PptxTableRenderNode["cells"][number], ctx: PptxPaintContext): SvgNode | null {
  const stroke = cell.borders?.[side];
  if (!stroke) return null;
  const { x, y, w, h } = cell;
  const line = side === "l" ? { x1: x, y1: y, x2: x, y2: y + h } : side === "r" ? { x1: x + w, y1: y, x2: x + w, y2: y + h } : side === "t" ? { x1: x, y1: y, x2: x + w, y2: y } : { x1: x, y1: y + h, x2: x + w, y2: y + h };
  return svgEl("line", { ...strokePaint(stroke, ctx, { w: cell.w, h: cell.h }), ...line });
}

/** Cell fills, per-side borders and (counter-flipped) cell text, in z-order. */
export function tableContent(node: PptxTableRenderNode, options: DataNodeContext): SvgNode[] {
  const { ctx, origin, mirror } = options;
  const out: SvgNode[] = [];
  if (node.bgFill) {
    out.push(svgEl("rect", { x: 0, y: 0, width: px(node.box.w), height: px(node.box.h), ...fillPaint(node.bgFill, ctx, { w: node.box.w, h: node.box.h }, origin) }));
  }
  for (const cell of node.cells) {
    const paint = fillPaint(cell.fill, ctx, { w: cell.w, h: cell.h }, { x: origin.x + cell.x, y: origin.y + cell.y });
    if (paint.fill !== "none") {
      out.push(svgEl("rect", { x: px(cell.x), y: px(cell.y), width: px(cell.w), height: px(cell.h), ...paint }));
    }
    for (const side of ["l", "t", "r", "b"] as const) {
      const border = cellBorder(side, cell, ctx);
      if (border) out.push(border);
    }
    const text = textBlockPaint(cell.text, mirror ? { ctx, mirror } : { ctx });
    if (text) out.push(svgEl("g", { transform: `translate(${px(cell.x)} ${px(cell.y)})` }, [text]));
  }
  return out;
}

/** Catmull-Rom (tension 0.4) approximation of Konva's smoothed polyline. */
function smoothPolylinePath(points: readonly number[], closed: boolean): string {
  const n = points.length / 2;
  if (n < 3) return polylinePath(points, closed);
  const at = (i: number): [number, number] => {
    const wrapped = closed ? (i + n) % n : Math.min(Math.max(i, 0), n - 1);
    return [points[wrapped * 2]!, points[wrapped * 2 + 1]!];
  };
  const tension = 0.4;
  let d = `M ${px(points[0]!)} ${px(points[1]!)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    const [p0x, p0y] = at(i - 1);
    const [p1x, p1y] = at(i);
    const [p2x, p2y] = at(i + 1);
    const [p3x, p3y] = at(i + 2);
    const c1x = p1x + ((p2x - p0x) * tension) / 2;
    const c1y = p1y + ((p2y - p0y) * tension) / 2;
    const c2x = p2x - ((p3x - p1x) * tension) / 2;
    const c2y = p2y - ((p3y - p1y) * tension) / 2;
    d += ` C ${px(c1x)} ${px(c1y)} ${px(c2x)} ${px(c2y)} ${px(p2x)} ${px(p2y)}`;
  }
  return closed ? `${d} Z` : d;
}

/** Plain polyline path (closed = ring). */
function polylinePath(points: readonly number[], closed: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) parts.push(`${i === 0 ? "M" : "L"} ${px(points[i]!)} ${px(points[i + 1]!)}`);
  return closed ? `${parts.join(" ")} Z` : parts.join(" ");
}

function arcPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/**
 * Pie/doughnut wedge path. Angles: 12 o'clock = -90 deg, clockwise positive, which is
 * exactly SVG's angle system with y pointing down (sweep-flag 1).
 */
function wedgePath(wedge: { cx: number; cy: number; outerR: number; innerR: number; startDeg: number; sweepDeg: number }): string {
  // `sweepDeg` is taken in absolute value and the arc always uses sweep-flag 1 (clockwise, the
  // OOXML `a:pie`/`a:doughnut` direction), so a negative `sweepDeg` would draw the complement of
  // the wedge. pptx-render only emits non-negative sweeps; clamp defensively instead of guessing.
  const sweep = Math.min(Math.abs(wedge.sweepDeg), 359.99);
  const start = wedge.startDeg;
  const end = start + Math.sign(wedge.sweepDeg || 1) * sweep;
  const [sx, sy] = arcPoint(wedge.cx, wedge.cy, wedge.outerR, start);
  const [ex, ey] = arcPoint(wedge.cx, wedge.cy, wedge.outerR, end);
  const largeArc = sweep > 180 ? 1 : 0;
  if (wedge.innerR > 0) {
    const [isx, isy] = arcPoint(wedge.cx, wedge.cy, wedge.innerR, start);
    const [iex, iey] = arcPoint(wedge.cx, wedge.cy, wedge.innerR, end);
    return `M ${px(sx)} ${px(sy)} A ${px(wedge.outerR)} ${px(wedge.outerR)} 0 ${largeArc} 1 ${px(ex)} ${px(ey)} L ${px(iex)} ${px(iey)} A ${px(wedge.innerR)} ${px(wedge.innerR)} 0 ${largeArc} 0 ${px(isx)} ${px(isy)} Z`;
  }
  return `M ${px(wedge.cx)} ${px(wedge.cy)} L ${px(sx)} ${px(sy)} A ${px(wedge.outerR)} ${px(wedge.outerR)} 0 ${largeArc} 1 ${px(ex)} ${px(ey)} Z`;
}

const CHART_HAIRLINE = 0.75;

/** Gridlines, axes, bars, polylines, markers, swatches, paths, wedges and labels. */
export function chartContent(node: PptxChartRenderNode, options: DataNodeContext): SvgNode[] {
  const { ctx, origin } = options;
  const out: SvgNode[] = [];
  const box = { w: node.box.w, h: node.box.h };
  if (node.bgFill) out.push(svgEl("rect", { x: 0, y: 0, width: px(box.w), height: px(box.h), ...fillPaint(node.bgFill, ctx, box, origin) }));
  const plot = node.plotRect;
  if (plot) {
    out.push(
      svgEl("rect", {
        x: px(plot.x),
        y: px(plot.y),
        width: px(plot.w),
        height: px(plot.h),
        ...(plot.fill ? fillPaint(plot.fill, ctx, { w: plot.w, h: plot.h }, origin) : { fill: "none" }),
        ...(plot.borderColor ? { stroke: normalizeColor(plot.borderColor), "stroke-width": px(plot.borderWidthPx ?? CHART_HAIRLINE) } : {}),
      }),
    );
  }
  for (const line of node.gridLines) {
    out.push(
      svgEl("line", {
        x1: px(line.x1),
        y1: px(line.y1),
        x2: px(line.x2),
        y2: px(line.y2),
        stroke: normalizeColor(line.color),
        "stroke-width": px(line.widthPx ?? CHART_HAIRLINE),
        ...(line.dash?.length ? { "stroke-dasharray": line.dash.map((value) => px(value)).join(" ") } : {}),
      }),
    );
  }
  for (const line of node.axisLines) {
    out.push(svgEl("line", { x1: px(line.x1), y1: px(line.y1), x2: px(line.x2), y2: px(line.y2), stroke: normalizeColor(line.color), "stroke-width": px(line.widthPx) }));
  }
  for (const bar of node.bars) out.push(svgEl("rect", { x: px(bar.x), y: px(bar.y), width: px(bar.w), height: px(bar.h), fill: normalizeColor(bar.color) }));
  for (const poly of node.polylines) {
    const d = poly.smooth ? smoothPolylinePath(poly.points, Boolean(poly.closed)) : polylinePath(poly.points, Boolean(poly.closed));
    out.push(
      svgEl("path", {
        d,
        fill: poly.fill ? normalizeColor(poly.fill) : "none",
        stroke: normalizeColor(poly.color),
        "stroke-width": px(poly.widthPx),
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        ...(poly.dash?.length ? { "stroke-dasharray": poly.dash.map((value) => px(value)).join(" ") } : {}),
      }),
    );
  }
  for (const wedge of node.wedges ?? []) {
    if (wedge.sweepDeg >= 359.99 && wedge.innerR <= 0) {
      out.push(svgEl("circle", { cx: px(wedge.cx), cy: px(wedge.cy), r: px(wedge.outerR), fill: wedge.noFill ? "none" : normalizeColor(wedge.color), ...wedgeStroke(wedge) }));
      continue;
    }
    out.push(svgEl("path", { d: wedgePath(wedge), fill: wedge.noFill ? "none" : normalizeColor(wedge.color), ...wedgeStroke(wedge) }));
  }
  for (const marker of node.markers) out.push(svgEl("circle", { cx: px(marker.x), cy: px(marker.y), r: px(marker.r), fill: normalizeColor(marker.color) }));
  for (const swatch of node.swatches) out.push(svgEl("rect", { x: px(swatch.x), y: px(swatch.y), width: px(swatch.w), height: px(swatch.h), fill: normalizeColor(swatch.color) }));
  for (const path of node.paths ?? []) {
    out.push(
      svgEl("path", {
        d: path.d,
        fill: normalizeColor(path.fill),
        ...(path.stroke ? { stroke: normalizeColor(path.stroke), "stroke-width": px(path.strokeWidthPx ?? CHART_HAIRLINE) } : {}),
        ...(path.dy ? { transform: `translate(0 ${px(path.dy)})` } : {}),
      }),
    );
  }
  out.push(...chartLabels(node));
  if (node.border) {
    out.push(svgEl("rect", { x: 0, y: 0, width: px(box.w), height: px(box.h), fill: "none", stroke: normalizeColor(node.border.color), "stroke-width": px(node.border.widthPx) }));
  }
  return out;
}

function wedgeStroke(wedge: { stroke?: string; strokeWidthPx?: number; noFill?: boolean }): Record<string, SvgAttrValue> {
  const color = wedge.stroke ?? (wedge.noFill ? "none" : "#ffffff");
  if (color === "none") return wedge.strokeWidthPx ? { "stroke-width": px(wedge.strokeWidthPx) } : {};
  return { stroke: normalizeColor(color), "stroke-width": px(wedge.strokeWidthPx ?? CHART_HAIRLINE) };
}

/**
 * pptx-render measures every chart label with the theme minor face (Calibri, via its Carlito
 * alias) but ships no width, so a label drawn without a family inherits the page UI font and
 * runs wider than the room the engine left for it.
 */
const CHART_LABEL_FONT = displayFontFamily("Calibri");
const LEGEND_GAP_PX = 4;
/** Swatch drop below the label top, in em: pie/doughnut legends (buildPieNode) use 0.25, the rest 0.3. */
const LEGEND_SWATCH_DROP = 0.3;
const PIE_LEGEND_SWATCH_DROP = 0.25;

/** `styleInfo.kind` values the engine's pie builder (buildPieNode) emits: every `kind === "pie"` model. */
const PIE_CHART_KINDS: ReadonlySet<string> = new Set(["pie", "doughnut", "pie3D"]);

/**
 * Whether the legend uses the pie/doughnut swatch spacing. Decided from the chart kind the engine
 * echoes on every chart node; `wedges` is no discriminator because buildSunburstNode (and any
 * future builder) also seeds an empty `wedges` array. Only a node without `styleInfo` (hand-built,
 * never engine output) falls back to "has wedges", where an empty array means no pie.
 */
function isPieLegend(node: PptxChartRenderNode): boolean {
  if (node.styleInfo) return PIE_CHART_KINDS.has(node.styleInfo.kind);
  return (node.wedges?.length ?? 0) > 0;
}

/**
 * Width the engine reserved for a legend label: legend items are laid out left to right as
 * `swatch + 4 + textWidth + swatch` (the swatch is half an em), so the distance to the next
 * swatch on the same row recovers the measured text width. Undefined for the last item and for
 * labels that are not legend entries (ticks, titles).
 */
function legendTextWidth(label: PptxChartRenderNode["labels"][number], node: PptxChartRenderNode): number | undefined {
  const drop = isPieLegend(node) ? PIE_LEGEND_SWATCH_DROP : LEGEND_SWATCH_DROP;
  const swatch = node.swatches.find((s) => Math.abs(s.x + s.w + LEGEND_GAP_PX - label.x) < 0.01 && Math.abs(s.y - (label.y + label.fontSizePx * drop)) < 0.01);
  if (!swatch) return undefined;
  const next = node.swatches.filter((s) => Math.abs(s.y - swatch.y) < 0.01 && s.x > swatch.x).sort((a, b) => a.x - b.x)[0];
  if (!next) return undefined;
  const width = next.x - swatch.x - swatch.w * 2 - LEGEND_GAP_PX;
  return width > 0 ? width : undefined;
}

/** Chart tick/category/legend/axis-title labels (`y` is the text top; SVG wants the baseline,
 *  and a rotated label must pivot on its declared top-left like the oracle's Konva Text). */
function chartLabels(node: PptxChartRenderNode): SvgNode[] {
  return node.labels.map((label) => {
    const legendWidth = [...label.text].length > 1 && !label.rotationDeg ? legendTextWidth(label, node) : undefined;
    const text = svgText(
      "text",
      {
        x: px(label.x),
        y: px(label.y + label.fontSizePx * 0.8),
        "font-family": CHART_LABEL_FONT,
        "font-size": px(label.fontSizePx),
        fill: normalizeColor(label.color),
        "xml:space": "preserve",
        ...(legendWidth ? { textLength: px(legendWidth), lengthAdjust: "spacing" } : {}),
        ...(label.bold ? { "font-weight": "bold" } : {}),
        ...(label.italic ? { "font-style": "italic" } : {}),
      },
      label.text,
    );
    if (!label.rotationDeg) return text;
    return svgEl("g", { transform: `rotate(${px(label.rotationDeg)} ${px(label.x)} ${px(label.y)})` }, [text]);
  });
}

/** UniWork token-styled chip for a passthrough element the engine cannot draw yet. */
export function chipContent(node: PptxChipRenderNode, ctx: PptxPaintContext): SvgNode[] {
  const { palette } = ctx;
  const label = node.label || node.kind;
  return [
    svgEl("rect", {
      x: 0,
      y: 0,
      width: px(node.box.w),
      height: px(node.box.h),
      rx: 6,
      class: "fill-muted stroke-border",
      fill: palette.chipFill,
      stroke: palette.chipStroke,
      "stroke-width": 1,
    }),
    svgText(
      "text",
      {
        x: px(node.box.w / 2),
        y: px(node.box.h / 2),
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-size": px(Math.min(16, Math.max(10, node.box.h * 0.18))),
        class: "fill-muted-foreground",
        fill: palette.chipText,
        "xml:space": "preserve",
      },
      label,
    ),
  ];
}
