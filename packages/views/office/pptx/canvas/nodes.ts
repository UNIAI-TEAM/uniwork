/**
 * Render tree -> SVG elements. One recursive pass over the slide's nodes: shapes (fills,
 * strokes, preset/custom geometry, connectors), pictures (crop, clip, blip effects, media
 * badge), groups (children are in group-local coordinates, so a plain nested `<g>` with the
 * group's placement transform is enough) and the table/chart/chip families from
 * `data-nodes.ts`.
 *
 * Every node group carries `data-pptx-element-id` (source id), `data-pptx-node-type` and
 * its absolute page offset, which is the selection seam P0-3 consumes.
 */
import { chartContent, chipContent, tableContent } from "./data-nodes";
import { blipFilter, fillPaint, normalizeColor, shadowFilter, strokePaint, type PptxPaintContext } from "./paint";
import type { PptxArrowEndRender, PptxPictureRenderNode, PptxRenderNode, PptxShapeRenderNode } from "./render-tree";
import { boxTransform, pointsAttr, px, svgEl, type SvgAttrValue, type SvgNode } from "./svg-node";
import { textBlockPaint } from "./text";

export interface RenderNodeOptions {
  /** Absolute page-space offset of the box being painted (fill/pattern phase anchoring). */
  origin: { x: number; y: number };
  /** Mirror parity accumulated from flipped ancestor boxes. */
  inheritedFlipH: boolean;
  inheritedFlipV: boolean;
}

export interface NodeMirror {
  w: number;
  h: number;
  flipX: boolean;
  flipY: boolean;
}

function elementAttrs(node: PptxRenderNode, origin: { x: number; y: number }): Record<string, SvgAttrValue> {
  return {
    "data-pptx-element-id": node.sourceId,
    ...(node.durableId ? { "data-pptx-durable-id": node.durableId } : {}),
    "data-pptx-node-type": node.type,
    "data-pptx-page-x": px(origin.x),
    "data-pptx-page-y": px(origin.y),
    ...(node.decoration ? { "data-pptx-decoration": "true" } : {}),
    ...(node.background ? { "data-pptx-background": "true" } : {}),
  };
}

function counterFlipTransform(mirror: NodeMirror): string | undefined {
  if (!mirror.flipX && !mirror.flipY) return undefined;
  return `translate(${px(mirror.flipX ? mirror.w : 0)} ${px(mirror.flipY ? mirror.h : 0)}) scale(${mirror.flipX ? -1 : 1} ${mirror.flipY ? -1 : 1})`;
}

// ── Connector arrowheads ─────────────────────────────────────────────────────
// PowerPoint sizes arrows from the line width; the render tree already resolved px
// width/length. `arrow` is the open V, the others are closed silhouettes.
function arrowHead(end: PptxArrowEndRender, tip: [number, number], direction: [number, number], color: string): SvgNode {
  const len = Math.hypot(direction[0], direction[1]) || 1;
  const dx = direction[0] / len;
  const dy = direction[1] / len;
  const backX = tip[0] - dx * end.lengthPx;
  const backY = tip[1] - dy * end.lengthPx;
  const halfW = end.widthPx / 2;
  const perpX = -dy * halfW;
  const perpY = dx * halfW;
  const stroke = { stroke: normalizeColor(color), "stroke-width": Math.max(end.lengthPx / 8, 0.75), "stroke-linecap": "round" as const, fill: "none" };
  switch (end.type) {
    case "arrow":
      return svgEl("path", { ...stroke, d: `M ${px(backX + perpX)} ${px(backY + perpY)} L ${px(tip[0])} ${px(tip[1])} L ${px(backX - perpX)} ${px(backY - perpY)}` });
    case "stealth": {
      const notchX = tip[0] - dx * end.lengthPx * 0.7;
      const notchY = tip[1] - dy * end.lengthPx * 0.7;
      return svgEl("polygon", { fill: normalizeColor(color), points: `${px(tip[0])} ${px(tip[1])} ${px(backX + perpX)} ${px(backY + perpY)} ${px(notchX)} ${px(notchY)} ${px(backX - perpX)} ${px(backY - perpY)}` });
    }
    case "diamond": {
      const midX = tip[0] - dx * end.lengthPx * 0.5;
      const midY = tip[1] - dy * end.lengthPx * 0.5;
      return svgEl("polygon", { fill: normalizeColor(color), points: `${px(tip[0])} ${px(tip[1])} ${px(midX + perpX)} ${px(midY + perpY)} ${px(backX)} ${px(backY)} ${px(midX - perpX)} ${px(midY - perpY)}` });
    }
    case "oval": {
      const midX = tip[0] - dx * end.lengthPx * 0.5;
      const midY = tip[1] - dy * end.lengthPx * 0.5;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      return svgEl("ellipse", { cx: px(midX), cy: px(midY), rx: px(end.lengthPx / 2), ry: px(halfW), transform: `rotate(${px(angle)} ${px(midX)} ${px(midY)})`, fill: normalizeColor(color) });
    }
    case "triangle":
    default:
      return svgEl("polygon", { fill: normalizeColor(color), points: `${px(tip[0])} ${px(tip[1])} ${px(backX + perpX)} ${px(backY + perpY)} ${px(backX - perpX)} ${px(backY - perpY)}` });
  }
}

/** Connector polyline, or its smoothed bezier when the engine emitted control points. */
function connectorGeometry(node: PptxShapeRenderNode, stroke: Record<string, SvgAttrValue>, color: string): SvgNode[] {
  const points = node.line!.points;
  const out: SvgNode[] = [];
  if (node.line!.bezier?.length) {
    let d = `M ${px(points[0] ?? 0)} ${px(points[1] ?? 0)}`;
    const bezier = node.line!.bezier;
    for (let i = 0; i + 5 < bezier.length; i += 6) {
      d += ` C ${px(bezier[i]!)} ${px(bezier[i + 1]!)} ${px(bezier[i + 2]!)} ${px(bezier[i + 3]!)} ${px(bezier[i + 4]!)} ${px(bezier[i + 5]!)}`;
    }
    out.push(svgEl("path", { d, fill: "none", "stroke-linecap": "round", ...stroke }));
  } else {
    out.push(svgEl("polyline", { points: pointsAttr(points), fill: "none", "stroke-linecap": "round", ...stroke }));
  }
  const n = points.length / 2;
  if (n >= 2 && node.line!.tailEnd) {
    out.push(arrowHead(node.line!.tailEnd, [points[(n - 1) * 2]!, points[(n - 1) * 2 + 1]!], [points[(n - 1) * 2]! - points[(n - 2) * 2]!, points[(n - 1) * 2 + 1]! - points[(n - 2) * 2 + 1]!], color));
  }
  if (n >= 2 && node.line!.headEnd) {
    out.push(arrowHead(node.line!.headEnd, [points[0]!, points[1]!], [points[0]! - points[2]!, points[1]! - points[3]!], color));
  }
  return out;
}

/** SVG elements for the shape's outline: extrusion faces, custom paths, polygon, connector, ellipse or rect. */
function shapeGeometry(node: PptxShapeRenderNode, ctx: PptxPaintContext, origin: { x: number; y: number }): SvgNode[] {
  const fill = fillPaint(node.fill, ctx, { w: node.box.w, h: node.box.h }, origin);
  const stroke = strokePaint(node.stroke, ctx, { w: node.box.w, h: node.box.h });
  if (node.extrusion?.faces.length) {
    // scene3d/sp3d: pre-projected shaded faces in painter order replace the flat geometry.
    // The front cap may substitute the shape's own (gradient/image) fill; a transparent face
    // is a wireframe edge and stays unfilled.
    return node.extrusion.faces.map((face) =>
      svgEl("path", {
        d: face.path,
        ...(face.front ? fill : face.color === "transparent" ? { fill: "none" } : { fill: normalizeColor(face.color) }),
        "stroke-linejoin": "round",
        ...(face.stroke ? { stroke: normalizeColor(face.stroke), "stroke-width": px(face.strokeWidthPx ?? 1) } : {}),
      }),
    );
  }
  if (node.pathData || node.fillPathData || node.strokePathData) {
    const out: SvgNode[] = [];
    if (node.fillPathData) out.push(svgEl("path", { d: node.fillPathData, ...fill, "stroke-linejoin": "round" }));
    if (node.pathData) out.push(svgEl("path", { d: node.pathData, ...fill, ...stroke, "stroke-linejoin": "round" }));
    if (node.strokePathData) out.push(svgEl("path", { d: node.strokePathData, fill: "none", ...stroke, "stroke-linejoin": "round" }));
    return out;
  }
  if (node.line) return connectorGeometry(node, stroke, node.stroke?.color ?? "#000000");
  if (node.polygonPoints?.length) return [svgEl("polygon", { points: pointsAttr(node.polygonPoints), ...fill, ...stroke, "stroke-linejoin": "round" })];
  if (node.presetGeometry === "ellipse" || node.presetGeometry === "circle") {
    return [svgEl("ellipse", { cx: px(node.box.w / 2), cy: px(node.box.h / 2), rx: px(node.box.w / 2), ry: px(node.box.h / 2), ...fill, ...stroke })];
  }
  if (node.presetGeometry && node.presetGeometry !== "rect") {
    // Hand-built trees may carry only the preset name; ask the artifact for the geometry.
    // The artifact's buildRenderSlide resolves every preset, so this only covers fixtures
    // and hosts that hand the canvas their own tree.
    const polygon = ctx.presetPolygon?.(node.presetGeometry, node.box.w, node.box.h, node.adjust);
    if (polygon?.length) return [svgEl("polygon", { points: pointsAttr(polygon), ...fill, ...stroke, "stroke-linejoin": "round" })];
    const path = ctx.presetPath?.(node.presetGeometry, node.box.w, node.box.h, node.adjust);
    if (path?.d) return [svgEl("path", { d: path.d, ...fill, ...stroke, "stroke-linejoin": "round" })];
  }
  return [
    svgEl("rect", {
      x: 0,
      y: 0,
      width: px(node.box.w),
      height: px(node.box.h),
      ...(node.cornerRadiusPx ? { rx: px(node.cornerRadiusPx), ry: px(node.cornerRadiusPx) } : {}),
      ...fill,
      ...stroke,
    }),
  ];
}

function shapeContent(node: PptxShapeRenderNode, ctx: PptxPaintContext, origin: { x: number; y: number }, mirror: NodeMirror): SvgNode[] {
  const filter = shadowFilter(node.shadow, node.glow, ctx);
  const geometry = shapeGeometry(node, ctx, origin);
  const out: SvgNode[] = [svgEl("g", filter ? { filter: `url(#${filter})` } : undefined, geometry)];
  const text = textBlockPaint(node.text, { ctx, mirror });
  if (text) out.push(text);
  return out;
}

/** Picture shape geometry (picture styles), reused for the clip and the frame stroke. */
function pictureGeometry(node: PptxPictureRenderNode): SvgNode {
  const clip = node.clip;
  if (clip?.pathData) return svgEl("path", { d: clip.pathData });
  if (clip?.polygonPoints?.length) return svgEl("polygon", { points: pointsAttr(clip.polygonPoints) });
  return svgEl("rect", {
    x: 0,
    y: 0,
    width: px(node.box.w),
    height: px(node.box.h),
    ...(clip?.cornerRadiusPx ? { rx: px(clip.cornerRadiusPx), ry: px(clip.cornerRadiusPx) } : {}),
  });
}

function mediaBadge(node: PptxPictureRenderNode): SvgNode | null {
  if (!node.media) return null;
  const cx = node.box.w / 2;
  const cy = node.box.h / 2;
  const r = Math.min(22, Math.max(10, Math.min(node.box.w, node.box.h) * 0.18));
  const glyph = node.media === "video"
    ? svgEl("polygon", { points: pointsAttr([cx - r * 0.28, cy - r * 0.45, cx + r * 0.5, cy, cx - r * 0.28, cy + r * 0.45]), fill: "#ffffff" })
    : svgEl("path", { d: `M ${px(cx - r * 0.5)} ${px(cy - r * 0.2)} L ${px(cx - r * 0.15)} ${px(cy - r * 0.2)} L ${px(cx + r * 0.15)} ${px(cy - r * 0.5)} L ${px(cx + r * 0.15)} ${px(cy + r * 0.5)} L ${px(cx - r * 0.15)} ${px(cy + r * 0.2)} L ${px(cx - r * 0.5)} ${px(cy + r * 0.2)} Z`, fill: "#ffffff" });
  return svgEl("g", undefined, [svgEl("circle", { cx: px(cx), cy: px(cy), r: px(r), fill: "rgba(0,0,0,0.55)" }), glyph]);
}

function pictureContent(node: PptxPictureRenderNode, ctx: PptxPaintContext, origin: { x: number; y: number }): SvgNode[] {
  const out: SvgNode[] = [];
  const filter = shadowFilter(node.shadow, node.glow, ctx);
  const stroke = strokePaint(node.stroke, ctx, { w: node.box.w, h: node.box.h });
  if (node.bgColor) out.push(svgEl("rect", { x: 0, y: 0, width: px(node.box.w), height: px(node.box.h), fill: normalizeColor(node.bgColor) }));
  if (node.fill) out.push(svgEl("rect", { x: 0, y: 0, width: px(node.box.w), height: px(node.box.h), ...fillPaint(node.fill, ctx, { w: node.box.w, h: node.box.h }, origin) }));
  if (node.dataUrl) {
    const clipId = ctx.nextId("picclip");
    ctx.defs.push(svgEl("clipPath", { id: clipId }, [pictureGeometry(node)]));
    const src = node.srcRect;
    const spanX = src ? 1 - src.l - src.r : 1;
    const spanY = src ? 1 - src.t - src.b : 1;
    const drawW = spanX > 0 ? node.box.w / spanX : node.box.w;
    const drawH = spanY > 0 ? node.box.h / spanY : node.box.h;
    const blip = blipFilter({ ...(node.clrChange ? { clrChange: node.clrChange } : {}), ...(node.biLevel != null ? { biLevel: node.biLevel } : {}), ...(node.duotone ? { duotone: node.duotone } : {}), ...(node.lum ? { lum: node.lum } : {}) }, ctx);
    out.push(
      svgEl("image", {
        x: px(src ? -src.l * drawW : 0),
        y: px(src ? -src.t * drawH : 0),
        width: px(drawW),
        height: px(drawH),
        preserveAspectRatio: "none",
        href: node.dataUrl,
        "clip-path": `url(#${clipId})`,
        ...(node.opacity != null && node.opacity < 1 ? { opacity: px(node.opacity) } : {}),
        ...(blip ? { filter: `url(#${blip})` } : {}),
      }),
    );
  }
  if (Object.keys(stroke).length) out.push(svgEl("g", { ...stroke, fill: "none" }, [pictureGeometry(node)]));
  const badge = mediaBadge(node);
  const grouped = svgEl("g", filter ? { filter: `url(#${filter})` } : undefined, badge ? [...out, badge] : out);
  return [grouped];
}

/** Paints one node (and, for groups, its children) into absolute slide coordinates. */
export function renderNodePaint(node: PptxRenderNode, ctx: PptxPaintContext, options: RenderNodeOptions): SvgNode | null {
  const { box } = node;
  const childOptions: RenderNodeOptions = {
    origin: { x: options.origin.x + box.x, y: options.origin.y + box.y },
    inheritedFlipH: Boolean(box.flipH) !== options.inheritedFlipH,
    inheritedFlipV: Boolean(box.flipV) !== options.inheritedFlipV,
  };
  if (node.type === "group") {
    const children = node.children.map((child) => renderNodePaint(child, ctx, childOptions)).filter((child): child is SvgNode => child != null);
    return svgEl("g", { transform: boxTransform(box), ...elementAttrs(node, options.origin) }, children);
  }
  const mirror: NodeMirror = { w: box.w, h: box.h, flipX: childOptions.inheritedFlipH, flipY: childOptions.inheritedFlipV };
  const counterFlip = counterFlipTransform(mirror);
  let content: SvgNode[];
  switch (node.type) {
    case "picture":
      content = pictureContent(node, ctx, options.origin);
      break;
    case "table":
      content = tableContent(node, { ctx, origin: options.origin, mirror });
      break;
    case "chart":
      content = chartContent(node, { ctx, origin: options.origin });
      break;
    case "placeholder-chip":
      content = chipContent(node, ctx);
      break;
    default:
      content = shapeContent(node, ctx, options.origin, mirror);
      break;
  }
  const painted = counterFlip && (node.type === "chart" || node.type === "placeholder-chip") ? [svgEl("g", { transform: counterFlip }, content)] : content;
  return svgEl("g", { transform: boxTransform(box), ...elementAttrs(node, options.origin) }, painted);
}
