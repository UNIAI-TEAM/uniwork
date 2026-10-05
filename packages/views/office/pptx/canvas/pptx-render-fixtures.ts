/**
 * Hand-built render-tree fixtures and SVG assertions for the PPTX canvas suites. Video
 * fixtures are plain data (no artifact, no DOM): every case is a `RenderSlide` the vendored
 * builder could have produced.
 */
import type {
  PptxChartRenderNode,
  PptxGlyphRun,
  PptxPlacedBox,
  PptxRenderNode,
  PptxRenderSlide,
  PptxShapeRenderNode,
  PptxTableRenderNode,
  PptxTextLayout,
} from "./render-tree";
import type { SvgNode } from "./svg-node";

export function box(overrides: Partial<PptxPlacedBox> = {}): PptxPlacedBox {
  const x = overrides.x ?? 0;
  const y = overrides.y ?? 0;
  const w = overrides.w ?? 100;
  const h = overrides.h ?? 50;
  return {
    x,
    y,
    w,
    h,
    rotationDeg: overrides.rotationDeg ?? 0,
    flipH: overrides.flipH ?? false,
    flipV: overrides.flipV ?? false,
    centerX: overrides.centerX ?? x + w / 2,
    centerY: overrides.centerY ?? y + h / 2,
  };
}

export function slide(nodes: PptxRenderNode[], overrides: Partial<PptxRenderSlide> = {}): PptxRenderSlide {
  return {
    widthPx: overrides.widthPx ?? 960,
    heightPx: overrides.heightPx ?? 540,
    scale: overrides.scale ?? 1,
    background: overrides.background ?? { kind: "solid", color: "#ffffff" },
    nodes,
    ...(overrides.bgOwn ? { bgOwn: true } : {}),
    ...(overrides.bgGraphicsHidden ? { bgGraphicsHidden: true } : {}),
    ...(overrides.hidden ? { hidden: true } : {}),
  };
}

export function shapeNode(overrides: Partial<PptxShapeRenderNode> = {}): PptxShapeRenderNode {
  return {
    id: overrides.id ?? "r_shape-1",
    type: overrides.type ?? "shape",
    box: overrides.box ?? box({ x: 40, y: 30, w: 200, h: 120 }),
    sourceId: overrides.sourceId ?? "shape-1",
    fill: overrides.fill ?? { kind: "solid", color: "#3366CC" },
    ...overrides,
  };
}

export function run(overrides: Partial<PptxGlyphRun> = {}): PptxGlyphRun {
  return {
    text: overrides.text ?? "Hello",
    x: overrides.x ?? 8,
    baselineY: overrides.baselineY ?? 30,
    fontFamily: overrides.fontFamily ?? "Calibri",
    fontSizePx: overrides.fontSizePx ?? 24,
    color: overrides.color ?? "#000000",
    bold: overrides.bold ?? false,
    italic: overrides.italic ?? false,
    underline: overrides.underline ?? false,
    widthPx: overrides.widthPx ?? 60,
    ...overrides,
  };
}

export function textLayout(overrides: Partial<PptxTextLayout> = {}): PptxTextLayout {
  return {
    lines: overrides.lines ?? [{ runs: [run()], top: 8, height: 32 }],
    insets: overrides.insets ?? { l: 8, t: 4, r: 8, b: 4 },
    anchor: overrides.anchor ?? "top",
    fontScale: overrides.fontScale ?? 1,
    contentHeight: overrides.contentHeight ?? 40,
    wrap: overrides.wrap ?? true,
    ...overrides,
  };
}

export function tableNode(overrides: Partial<PptxTableRenderNode> = {}): PptxTableRenderNode {
  return {
    id: overrides.id ?? "r_table-1",
    type: "table",
    box: overrides.box ?? box({ x: 100, y: 80, w: 240, h: 100 }),
    sourceId: overrides.sourceId ?? "table-1",
    cells:
      overrides.cells ??
      [
        { x: 0, y: 0, w: 120, h: 50, row: 0, col: 0, fill: { kind: "solid", color: "#EEEEEE" }, borders: { l: { color: "#000000", widthPx: 1, widthPt: 0.75 }, b: { color: "#000000", widthPx: 1, widthPt: 0.75 } }, text: textLayout({ lines: [{ runs: [run({ text: "A1", x: 6, baselineY: 32 })], top: 6, height: 36 }] }) },
        { x: 120, y: 0, w: 120, h: 50, row: 0, col: 1, fill: { kind: "solid", color: "#FFFFFF" } },
      ],
    gridX: overrides.gridX ?? [0, 120, 240],
    gridY: overrides.gridY ?? [0, 50],
    ...overrides,
  };
}

export function chartNode(overrides: Partial<PptxChartRenderNode> = {}): PptxChartRenderNode {
  return {
    id: overrides.id ?? "r_chart-1",
    type: "chart",
    box: overrides.box ?? box({ x: 60, y: 60, w: 400, h: 260 }),
    sourceId: overrides.sourceId ?? "chart-1",
    gridLines: overrides.gridLines ?? [{ x1: 40, y1: 20, x2: 40, y2: 200, color: "#CCCCCC", dash: [3, 3] }],
    axisLines: overrides.axisLines ?? [{ x1: 40, y1: 200, x2: 380, y2: 200, color: "#333333", widthPx: 1 }],
    labels: overrides.labels ?? [{ text: "Q1", x: 50, y: 205, fontSizePx: 12, color: "#444444" }],
    bars: overrides.bars ?? [{ x: 50, y: 120, w: 40, h: 80, color: "#4472C4" }],
    polylines: overrides.polylines ?? [],
    markers: overrides.markers ?? [],
    swatches: overrides.swatches ?? [],
    ...overrides,
  };
}

/** Depth-first list of elements with the given tag. */
export function byTag(root: SvgNode, tag: string): SvgNode[] {
  const out: SvgNode[] = [];
  const visit = (node: SvgNode): void => {
    if (node.tag === tag) out.push(node);
    node.children?.forEach(visit);
  };
  visit(root);
  return out;
}

/** First element carrying the given `data-pptx-element-id`. */
export function elementGroup(root: SvgNode, sourceId: string): SvgNode | undefined {
  return byTag(root, "g").find((node) => node.attrs?.["data-pptx-element-id"] === sourceId);
}

/** Concatenated text content of every `<text>` element. */
export function textContent(root: SvgNode): string[] {
  return byTag(root, "text")
    .map((node) => (node.text ?? "").trim())
    .filter(Boolean);
}
