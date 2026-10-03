/**
 * Slide-level assembly: background + node tree + the `<defs>` collected while painting.
 * `buildSlideSvg` is the single entry point for both emitters — the React canvas mounts
 * `root`, the rail thumbnails serialize it with `slideSvgMarkup`/`svgDataUrl`.
 */
import { createPaintContext, fillPaint, type PptxCanvasPalette, type PptxImageSize, type PptxPaintContext } from "./paint";
import { renderNodePaint } from "./nodes";
import type { PptxNodeBox, PptxRenderSlide } from "./render-tree";
import { px, svgEl, type SvgNode } from "./svg-node";

export interface SlideSvgOptions {
  /** Prefix for every generated def id; must be unique per mounted SVG document. */
  idPrefix: string;
  palette: PptxCanvasPalette;
  /** Natural pixel size of a data URL (tiled picture/image fills). */
  imageSize?(dataUrl: string): PptxImageSize | undefined;
  /** 8x8 mask of an OOXML pattern preset (pattern fills). */
  patternGrid?(preset: string): boolean[][] | undefined;
  /** Preset geometry fallback for nodes carrying only `presetGeometry` (hand-built trees). */
  presetPath?(preset: string | undefined, w: number, h: number, adjust?: Record<string, number>): { d: string } | null;
  presetPolygon?(preset: string | undefined, w: number, h: number, adjust?: Record<string, number>): number[] | null;
}

export interface SlideSvgDocument {
  /** Root `<g>` in absolute page px, with `<defs>` as its first child. */
  root: SvgNode;
  widthPx: number;
  heightPx: number;
  paint: PptxPaintContext;
}

/** Full slide rendition: page background first, then nodes in z-order. */
export function buildSlideSvg(slide: PptxRenderSlide, options: SlideSvgOptions): SlideSvgDocument {
  const paint = createPaintContext(options);
  const background: SvgNode[] = [];
  if (slide.background.kind === "none") {
    background.push(svgEl("rect", { x: 0, y: 0, width: px(slide.widthPx), height: px(slide.heightPx), fill: options.palette.pageFill }));
  } else {
    background.push(svgEl("rect", { x: 0, y: 0, width: px(slide.widthPx), height: px(slide.heightPx), ...fillPaint(slide.background, paint, { w: slide.widthPx, h: slide.heightPx }) }));
  }
  const nodes = slide.nodes.map((node) => renderNodePaint(node, paint, { origin: { x: 0, y: 0 }, inheritedFlipH: false, inheritedFlipV: false })).filter((node): node is SvgNode => node != null);
  const defs = paint.defs.length ? [svgEl("defs", undefined, paint.defs)] : [];
  return {
    root: svgEl("g", undefined, [...defs, ...background, ...nodes]),
    widthPx: slide.widthPx,
    heightPx: slide.heightPx,
    paint,
  };
}

/** Flatten the node tree into absolute page boxes (group offsets applied). */
export function collectRenderNodeBoxes(slide: PptxRenderSlide): PptxNodeBox[] {
  const out: PptxNodeBox[] = [];
  const visit = (nodes: PptxRenderSlide["nodes"], offsetX: number, offsetY: number): void => {
    for (const node of nodes) {
      const box = {
        ...node.box,
        x: node.box.x + offsetX,
        y: node.box.y + offsetY,
        centerX: node.box.centerX + offsetX,
        centerY: node.box.centerY + offsetY,
      };
      out.push({
        sourceId: node.sourceId,
        ...(node.durableId ? { durableId: node.durableId } : {}),
        type: node.type,
        box,
        ...(node.decoration ? { decoration: true } : {}),
        ...(node.background ? { background: true } : {}),
      });
      if (node.type === "group") visit(node.children, box.x, box.y);
    }
  };
  visit(slide.nodes, 0, 0);
  return out;
}
