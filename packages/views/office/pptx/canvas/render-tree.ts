/**
 * The pptx-render render-tree contract, mirrored for the view layer.
 *
 * Source of truth (read-only, vendored): `packages/office-upstream/upstream/packages/
 * pptx-render/src/render-tree.ts` and `coords.ts`. The browser artifact P0-1 builds exposes
 * the same data shapes from `buildRenderSlide`; the canvas declares its own copy for two
 * reasons: the SVG mapping stays unit-testable without the artifact bundle, and a host can
 * hand the canvas a hand-built tree. Every field the SVG renderer reads is listed here.
 * Fields upstream adds later are intentionally absent until the canvas consumes them; the
 * P0-2 report carries the covered-vs-skipped list.
 */

export interface PptxViewport {
  /** Target canvas width (px) */
  widthPx: number;
  /** Target canvas height (px) */
  heightPx: number;
  /** Uniform EMU -> px scale factor (96dpi baseline included) */
  scale: number;
}

/** EMU slide size (pptx-engine `SlideDeck['size']`). */
export interface PptxSlideSize {
  cx: number;
  cy: number;
}

/** Converted placement box; rotation/flip pivot on the box center. */
export interface PptxPlacedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg: number;
  flipH: boolean;
  flipV: boolean;
  centerX: number;
  centerY: number;
}

export type PptxRenderFill =
  | { kind: "none" }
  | { kind: "solid"; color: string }
  | {
      kind: "gradient";
      stops: Array<{ pos: number; color: string }>;
      angleDeg: number;
      scaled?: boolean;
      radial?: boolean;
      path?: "circle" | "rect" | "shape";
      center?: { x: number; y: number };
      tileRect?: { l: number; t: number; r: number; b: number };
    }
  | {
      kind: "image";
      dataUrl?: string;
      mode: "stretch" | "tile";
      alpha?: number;
      fillRect?: { l: number; t: number; r: number; b: number };
      duotone?: [string, string];
      lum?: { bright: number; contrast: number };
      clrChange?: { from: string; to: string };
      biLevel?: number;
      tile?: {
        scaleX: number;
        scaleY: number;
        txPx: number;
        tyPx: number;
        algn: string;
        frame?: { x: number; y: number; w: number; h: number };
      };
    }
  | { kind: "pattern"; preset: string; fg: string; bg: string; cellPx: number };

export interface PptxRenderStroke {
  color: string;
  widthPx: number;
  widthPt?: number;
  dash?: number[];
  dashPreset?: string;
  cap?: "butt" | "round" | "square";
  join?: "round" | "bevel" | "miter";
  compound?: string;
  gradient?: { stops: Array<{ pos: number; color: string }>; angleDeg: number; scaled?: boolean };
}

export interface PptxRenderShadow {
  color: string;
  blurPx: number;
  offsetX: number;
  offsetY: number;
  inner?: boolean;
  scaleX?: number;
  scaleY?: number;
  skewXDeg?: number;
  skewYDeg?: number;
  algn?: string;
}

export interface PptxRenderGlow {
  color: string;
  blurPx: number;
}

export interface PptxGlyphRun {
  text: string;
  /** px relative to the text box top-left (baseline left endpoint) */
  x: number;
  /** Baseline y (px relative to the text box top-left) */
  baselineY: number;
  fontFamily: string;
  srcFontFamily?: string;
  fontSizePx: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike?: boolean;
  highlight?: string;
  baselinePct?: number;
  widthPx: number;
  logicalOrder?: number;
  letterSpacingPx?: number;
  kerningOff?: boolean;
  outline?: { color: string; widthPx: number };
  shadow?: { color: string; blurPx: number; offsetX: number; offsetY: number };
  gradient?: { stops: Array<{ pos: number; color: string }>; angleDeg: number; scaled?: boolean };
  glow?: { color: string; blurPx: number };
  reflection?: boolean;
  justifyExtraPx?: number;
  baselineShiftPx?: number;
  rotate90?: boolean;
  rotate270?: boolean;
  isBullet?: boolean;
  numType?: string;
  startAt?: number;
  image?: string;
  rtl?: boolean;
  srcRunIdx?: number;
  link?: string;
  ascentPx?: number;
}

export interface PptxTextLine {
  runs: PptxGlyphRun[];
  /** Line top y (px relative to the text box top-left) */
  top: number;
  height: number;
  advance?: number;
  paraStart?: boolean;
  trailingSpace?: boolean;
  trailingText?: string;
  softBreakAfter?: number;
  align?: "left" | "center" | "right" | "justify";
  rtl?: boolean;
  level?: number;
  marLPx?: number;
  indentPx?: number;
  leadAbove?: number;
}

export interface PptxTextLayout {
  lines: PptxTextLine[];
  insets: { l: number; t: number; r: number; b: number };
  anchor: "top" | "middle" | "bottom";
  fontScale: number;
  lnSpcReduction?: number;
  contentHeight: number;
  inkBottom?: number;
  wrap: boolean;
  autofit?: "none" | "shrink" | "resize";
  vert?: "eaVert" | "vert" | "vert270" | "wordArtVert";
  extrusion?: { color: string; dx: number; dy: number };
  txWarp?: { prst: string; adj?: Record<string, number> };
}

export interface PptxArrowEndRender {
  type: "arrow" | "triangle" | "stealth" | "diamond" | "oval";
  widthPx: number;
  lengthPx: number;
}

export interface PptxRenderNodeBase {
  id: string;
  box: PptxPlacedBox;
  /** Source Slide element id, used by the edit layer to locate write-backs */
  sourceId: string;
  durableId?: string;
  decoration?: boolean;
  background?: boolean;
}

export interface PptxShapeRenderNode extends PptxRenderNodeBase {
  type: "shape" | "text";
  placeholder?: string;
  txBox?: boolean;
  presetGeometry?: string;
  adjust?: Record<string, number>;
  cornerRadiusPx?: number;
  polygonPoints?: number[];
  pathData?: string;
  fillPathData?: string;
  strokePathData?: string;
  line?: {
    points: number[];
    bezier?: number[];
    headEnd?: PptxArrowEndRender;
    tailEnd?: PptxArrowEndRender;
  };
  fill: PptxRenderFill;
  fillOverlay?: PptxRenderFill;
  softEdgePx?: number;
  stroke?: PptxRenderStroke;
  shadow?: PptxRenderShadow;
  glow?: PptxRenderGlow;
  reflection?: { blurPx: number; startAlpha: number; endPos: number; distPx: number };
  extrusion?: { faces: Array<{ path: string; color: string; front?: boolean; stroke?: string; strokeWidthPx?: number }>; wireframe?: boolean };
  text?: PptxTextLayout;
}

export interface PptxPictureRenderNode extends PptxRenderNodeBase {
  type: "picture";
  dataUrl?: string;
  bgColor?: string;
  fill?: PptxRenderFill;
  duotone?: [string, string];
  lum?: { bright: number; contrast: number };
  clrChange?: { from: string; to: string };
  biLevel?: number;
  clip?: { cornerRadiusPx?: number; polygonPoints?: number[]; pathData?: string };
  srcRect?: { l: number; t: number; r: number; b: number };
  opacity?: number;
  softEdgePx?: number;
  media?: "video" | "audio";
  stroke?: PptxRenderStroke;
  shadow?: PptxRenderShadow;
  glow?: PptxRenderGlow;
  reflection?: { blurPx: number; startAlpha: number; endPos: number; distPx: number };
  name?: string;
  descr?: string;
}

export interface PptxGroupRenderNode extends PptxRenderNodeBase {
  type: "group";
  /** Children boxes are in group-local coordinates (relative to the group top-left). */
  children: PptxRenderNode[];
  childScaleX?: number;
  childScaleY?: number;
}

export interface PptxTableCellRender {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
  gridSpan?: number;
  rowSpan?: number;
  fill: PptxRenderFill;
  borders?: {
    l?: PptxRenderStroke;
    r?: PptxRenderStroke;
    t?: PptxRenderStroke;
    b?: PptxRenderStroke;
  };
  text?: PptxTextLayout;
}

export interface PptxTableRenderNode extends PptxRenderNodeBase {
  type: "table";
  cells: PptxTableCellRender[];
  bgFill?: PptxRenderFill;
  gridX: number[];
  gridY: number[];
  rtl?: boolean;
  styleFlags?: { firstRow: boolean; bandRow: boolean };
}

export interface PptxChartLabel {
  text: string;
  x: number;
  y: number;
  fontSizePx: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  rotationDeg?: number;
}

export interface PptxChartRenderNode extends PptxRenderNodeBase {
  type: "chart";
  appCreated?: boolean;
  styleInfo?: { kind: string; legendPos: string; dataLabels: boolean; gridlines: boolean; title?: string };
  bgFill?: PptxRenderFill;
  border?: { color: string; widthPx: number };
  plotRect?: { x: number; y: number; w: number; h: number; fill?: PptxRenderFill; borderColor?: string; borderWidthPx?: number };
  gridLines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dash?: number[]; widthPx?: number }>;
  axisLines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; widthPx: number }>;
  labels: PptxChartLabel[];
  bars: Array<{ x: number; y: number; w: number; h: number; color: string }>;
  polylines: Array<{ points: number[]; color: string; widthPx: number; smooth?: boolean; closed?: boolean; fill?: string; dash?: number[] }>;
  markers: Array<{ x: number; y: number; r: number; color: string }>;
  swatches: Array<{ x: number; y: number; w: number; h: number; color: string }>;
  paths?: Array<{ d: string; fill: string; stroke?: string; strokeWidthPx?: number; dy?: number }>;
  wedges?: Array<{
    cx: number;
    cy: number;
    outerR: number;
    innerR: number;
    startDeg: number;
    sweepDeg: number;
    color: string;
    noFill?: boolean;
    stroke?: string;
    strokeWidthPx?: number;
  }>;
}

export interface PptxChipRenderNode extends PptxRenderNodeBase {
  type: "placeholder-chip";
  kind: string;
  label: string;
}

export type PptxRenderNode =
  | PptxShapeRenderNode
  | PptxPictureRenderNode
  | PptxGroupRenderNode
  | PptxTableRenderNode
  | PptxChartRenderNode
  | PptxChipRenderNode;

export interface PptxRenderSlide {
  widthPx: number;
  heightPx: number;
  /** Viewport scale (fitWidthPx / slide baseline px width) */
  scale: number;
  background: PptxRenderFill;
  bgOwn?: boolean;
  bgGraphicsHidden?: boolean;
  nodes: PptxRenderNode[];
  hidden?: boolean;
}

/** One node box in absolute page px, flattened out of its group nesting. */
export interface PptxNodeBox {
  sourceId: string;
  durableId?: string;
  type: PptxRenderNode["type"];
  box: PptxPlacedBox;
  decoration?: boolean;
  background?: boolean;
}
