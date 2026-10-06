/**
 * Paint resolution for the SVG renderer: render-tree fills/strokes/shadows -> SVG
 * attributes plus the `<defs>` entries they reference (gradients, patterns, filters).
 *
 * The render tree already carries resolved colors and px geometry (pptx-render owns
 * fidelity); this file only maps that data onto SVG primitives. Known deviations are
 * listed in the P0-2 report: inner/perspective shadows, `path: 'rect' | 'shape'` radial
 * gradients, `fillOverlay` blending and PowerPoint's linear-light gradient ramp.
 */
import type { PptxRenderFill, PptxRenderGlow, PptxRenderShadow, PptxRenderStroke } from "./render-tree";
import { px, svgEl, type SvgAttrValue, type SvgNode } from "./svg-node";

/** Colors the canvas needs beyond the document's own content: the placeholder chip. */
export interface PptxCanvasPalette {
  /** Slide page fill for a deck that declares no background (PowerPoint's paper page). */
  pageFill: string;
  chipFill: string;
  chipStroke: string;
  chipText: string;
}

const TOKEN_FALLBACK = "-";

/** Read the semantic tokens the chip is painted with; missing tokens stay empty so the
 *  DOM presentation attribute (which the className overrides) is simply absent. */
export function readPptxPalette(style: { getPropertyValue(name: string): string }): PptxCanvasPalette {
  const read = (name: string): string => style.getPropertyValue(name).trim() || TOKEN_FALLBACK;
  return {
    pageFill: "#ffffff",
    chipFill: read("--muted"),
    chipStroke: read("--border"),
    chipText: read("--muted-foreground"),
  };
}

export interface PptxImageSize {
  width: number;
  height: number;
}

export interface PptxPaintContext {
  palette: PptxCanvasPalette;
  defs: SvgNode[];
  nextId(kind: string): string;
  /** Natural pixel size of a data URL, when the host can resolve it (tiled image fills). */
  imageSize?(dataUrl: string): PptxImageSize | undefined;
  /** 8x8 foreground mask of an OOXML preset pattern; without it patterns degrade to `bg`. */
  patternGrid?(preset: string): boolean[][] | undefined;
  /** OOXML preset geometry fallback; without it preset-only nodes degrade to a rect. */
  presetPath?(preset: string | undefined, w: number, h: number, adjust?: Record<string, number>): { d: string } | null;
  presetPolygon?(preset: string | undefined, w: number, h: number, adjust?: Record<string, number>): number[] | null;
}

interface PptxPaintContextOptions {
  idPrefix: string;
  palette: PptxCanvasPalette;
  imageSize?(dataUrl: string): PptxImageSize | undefined;
  patternGrid?(preset: string): boolean[][] | undefined;
  presetPath?(preset: string | undefined, w: number, h: number, adjust?: Record<string, number>): { d: string } | null;
  presetPolygon?(preset: string | undefined, w: number, h: number, adjust?: Record<string, number>): number[] | null;
}

export function createPaintContext(options: PptxPaintContextOptions): PptxPaintContext {
  const defs: SvgNode[] = [];
  let seq = 0;
  return {
    palette: options.palette,
    defs,
    nextId: (kind) => `${options.idPrefix}-${kind}-${(seq += 1)}`,
    ...(options.imageSize ? { imageSize: options.imageSize } : {}),
    ...(options.patternGrid ? { patternGrid: options.patternGrid } : {}),
    ...(options.presetPath ? { presetPath: options.presetPath } : {}),
    ...(options.presetPolygon ? { presetPolygon: options.presetPolygon } : {}),
  };
}

/** #RRGGBBAA -> rgba(...); bare hex gets a leading #; `none` stays transparent. */
export function normalizeColor(color: string): string {
  if (color === "none") return "transparent";
  if (/^#?[0-9A-Fa-f]{8}$/.test(color)) {
    const hex = color.replace(/^#/, "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`;
  }
  return color.startsWith("#") || color.startsWith("rgb") ? color : `#${color}`;
}

// ── Gradient ramps ────────────────────────────────────────────────────────────
// PowerPoint blends gradient stops in linear light; SVG interpolates in sRGB. Subdivide
// each declared pair with linear-light midpoints so the on-screen ramp tracks the deck.
const SUBDIVISIONS = 6;
const srgbToLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function parseStopColor(color: string): [number, number, number, number] | null {
  const hex = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/.exec(color);
  if (hex) {
    const h = hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), hex[2] ? parseInt(hex[2], 16) / 255 : 1];
  }
  const rgba = /^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/.exec(color);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] ? Number(rgba[4]) : 1];
  return null;
}

/** Declared stops -> stops SVG can interpolate, with linear-light midpoints added. */
export function rampStops(stops: Array<{ pos: number; color: string }>): Array<{ pos: number; color: string }> {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const out: Array<{ pos: number; color: string }> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    out.push({ pos: current.pos, color: normalizeColor(current.color) });
    const next = sorted[i + 1];
    if (!next || next.color === current.color) continue;
    const a = parseStopColor(current.color);
    const b = parseStopColor(next.color);
    if (!a || !b || next.pos - current.pos < 0.02) continue;
    const span = next.pos - current.pos;
    for (let k = 1; k < SUBDIVISIONS; k += 1) {
      const t = k / SUBDIVISIONS;
      const ch = (index: number) => Math.round(linToSrgb(srgbToLin(a[index]! / 255) + (srgbToLin(b[index]! / 255) - srgbToLin(a[index]! / 255)) * t) * 255);
      const alpha = a[3] + (b[3] - a[3]) * t;
      const color = alpha >= 1 ? `rgb(${ch(0)},${ch(1)},${ch(2)})` : `rgba(${ch(0)},${ch(1)},${ch(2)},${Number(alpha.toFixed(3))})`;
      out.push({ pos: current.pos + span * t, color });
    }
  }
  return out;
}

function stopNodes(stops: Array<{ pos: number; color: string }>): SvgNode[] {
  return rampStops(stops).map((stop) => svgEl("stop", { offset: px(Math.min(Math.max(stop.pos, 0), 1)), "stop-color": stop.color }));
}

/** Unit direction of an `a:lin` gradient, unsquashed by the box aspect for `scaled="1"`. */
function linearGradientDirection(angleDeg: number, scaled: boolean | undefined, w: number, h: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  if (!scaled) return [Math.cos(rad), Math.sin(rad)];
  const vx = h * Math.cos(rad);
  const vy = w * Math.sin(rad);
  const n = Math.hypot(vx, vy) || 1;
  return [vx / n, vy / n];
}

/** Gradient vector spanning the box's projection onto its direction (a:lin semantics). */
export function linearGradientLine(angleDeg: number, scaled: boolean | undefined, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  const [dx, dy] = linearGradientDirection(angleDeg, scaled, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.abs(dx) * w + Math.abs(dy) * h;
  return { x1: cx - (dx * len) / 2, y1: cy - (dy * len) / 2, x2: cx + (dx * len) / 2, y2: cy + (dy * len) / 2 };
}

/** Radial centre + radius: 100% sits on the farthest corner of the tile rect. */
function radialCircleGeometry(
  w: number,
  h: number,
  center?: { x: number; y: number },
  tileRect?: { l: number; t: number; r: number; b: number },
): { cx: number; cy: number; r: number } {
  const cx = (center?.x ?? 0.5) * w;
  const cy = (center?.y ?? 0.5) * h;
  const x0 = Math.min(0, (tileRect?.l ?? 0) * w);
  const y0 = Math.min(0, (tileRect?.t ?? 0) * h);
  const x1 = Math.max(w, w - (tileRect?.r ?? 0) * w);
  const y1 = Math.max(h, h - (tileRect?.b ?? 0) * h);
  const r = Math.max(Math.hypot(cx - x0, cy - y0), Math.hypot(x1 - cx, cy - y0), Math.hypot(cx - x0, y1 - cy), Math.hypot(x1 - cx, y1 - cy));
  return { cx, cy, r };
}

// ── Blip (picture/fill pixel) effects as SVG filters ─────────────────────────

export interface PptxBlipEffects {
  clrChange?: { from: string; to: string };
  biLevel?: number;
  duotone?: [string, string];
  lum?: { bright: number; contrast: number };
}

function hasBlipEffects(fx: PptxBlipEffects): boolean {
  return Boolean(fx.clrChange || fx.biLevel != null || fx.duotone || fx.lum);
}

/** Channel tolerance of `<a:clrChange>` (absorbs rasterizer rounding, like the oracle). */
const CLR_CHANGE_TOLERANCE = 4;

/**
 * PowerPoint's pixel-effect order (clrChange -> biLevel -> duotone -> lum) expressed as
 * `feComponentTransfer`: clrChange/biLevel use discrete 256/2-entry tables, lum a linear
 * transfer (contrast around mid grey, then a blend toward white/black).
 */
export function blipFilter(fx: PptxBlipEffects, ctx: PptxPaintContext): string | undefined {
  if (!hasBlipEffects(fx)) return undefined;
  const id = ctx.nextId("blip");
  const primitives: SvgNode[] = [];
  let current = "SourceGraphic";
  if (fx.clrChange) {
    const from = parseStopColor(fx.clrChange.from) ?? [0, 0, 0, 1];
    const to = parseStopColor(fx.clrChange.to) ?? [0, 0, 0, 1];
    const match = (v: number, index: number) => Math.abs(v - from[index]!) <= CLR_CHANGE_TOLERANCE;
    // Per channel: matched pixels take the target value, everything else keeps its own level.
    // Alpha is passed through — a filter primitive cannot key the alpha on an RGB match, and
    // scaling it globally would make fully transparent pixels opaque (report gap).
    const replaced = [0, 1, 2].map((index) => {
      const values: number[] = [];
      for (let i = 0; i < 256; i += 1) values.push(match(i, index) ? to[index]! : i);
      return values.join(" ");
    });
    primitives.push(
      svgEl("feComponentTransfer", { in: current, result: `${id}-cc` }, [
        svgEl("feFuncR", { type: "discrete", tableValues: replaced[0]! }),
        svgEl("feFuncG", { type: "discrete", tableValues: replaced[1]! }),
        svgEl("feFuncB", { type: "discrete", tableValues: replaced[2]! }),
      ]),
    );
    current = `${id}-cc`;
  }
  if (fx.biLevel != null) {
    primitives.push(
      svgEl("feColorMatrix", { in: current, type: "matrix", values: "0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0", result: `${id}-lum` }),
      svgEl("feComponentTransfer", { in: `${id}-lum`, result: `${id}-bl` }, [
        svgEl("feFuncR", { type: "discrete", tableValues: `0 1` }),
        svgEl("feFuncG", { type: "discrete", tableValues: `0 1` }),
        svgEl("feFuncB", { type: "discrete", tableValues: `0 1` }),
        svgEl("feFuncA", { type: "linear", slope: 1, intercept: 0 }),
      ]),
    );
    current = `${id}-bl`;
  }
  if (fx.duotone) {
    const [dark, light] = fx.duotone.map((c) => parseStopColor(c) ?? [0, 0, 0, 1]) as [number[], number[]];
    primitives.push(
      svgEl("feColorMatrix", { in: current, type: "matrix", values: "0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0", result: `${id}-dl` }),
      svgEl("feComponentTransfer", { in: `${id}-dl`, result: `${id}-duo` }, [
        svgEl("feFuncR", { type: "table", tableValues: `${(dark[0] ?? 0) / 255} ${(light[0] ?? 0) / 255}` }),
        svgEl("feFuncG", { type: "table", tableValues: `${(dark[1] ?? 0) / 255} ${(light[1] ?? 0) / 255}` }),
        svgEl("feFuncB", { type: "table", tableValues: `${(dark[2] ?? 0) / 255} ${(light[2] ?? 0) / 255}` }),
      ]),
    );
    current = `${id}-duo`;
  }
  if (fx.lum) {
    const slope = fx.lum.contrast >= 0 ? 1 / (1 - Math.min(fx.lum.contrast, 0.99)) : 1 + fx.lum.contrast;
    const bright = fx.lum.bright;
    const gain = bright >= 0 ? slope * (1 - bright) : slope * (1 + bright);
    const offset = bright >= 0 ? (0.5 - 0.5 * slope) * (1 - bright) + bright : (0.5 - 0.5 * slope) * (1 + bright);
    primitives.push(
      svgEl("feComponentTransfer", { in: current, result: `${id}-lum2` }, [
        svgEl("feFuncR", { type: "linear", slope: Number(gain.toFixed(5)), intercept: Number(offset.toFixed(5)) }),
        svgEl("feFuncG", { type: "linear", slope: Number(gain.toFixed(5)), intercept: Number(offset.toFixed(5)) }),
        svgEl("feFuncB", { type: "linear", slope: Number(gain.toFixed(5)), intercept: Number(offset.toFixed(5)) }),
      ]),
    );
  }
  ctx.defs.push(svgEl("filter", { id, "color-interpolation-filters": "sRGB" }, primitives));
  return id;
}

/**
 * Outer shadow / glow -> `feDropShadow` (canvas `shadowBlur` maps to 2 sigma).
 * Inner and perspective shadows (scale/skew/`algn`) need an offscreen silhouette and are
 * not drawn; the report lists them as gaps.
 */
export function shadowFilter(shadow: PptxRenderShadow | undefined, glow: PptxRenderGlow | undefined, ctx: PptxPaintContext): string | undefined {
  const outer = shadow && !shadow.inner && shadow.scaleX == null && shadow.scaleY == null && !shadow.skewXDeg && !shadow.skewYDeg ? shadow : undefined;
  if (!outer && !glow) return undefined;
  const color = outer ? outer.color : glow!.color;
  const blur = outer ? outer.blurPx : glow!.blurPx;
  const id = ctx.nextId("shadow");
  ctx.defs.push(
    svgEl("filter", { id, x: "-40%", y: "-40%", width: "180%", height: "180%", "color-interpolation-filters": "sRGB" }, [
      svgEl("feDropShadow", {
        dx: px(outer ? outer.offsetX : 0),
        dy: px(outer ? outer.offsetY : 0),
        stdDeviation: px(Math.max(blur / 2, 0)),
        "flood-color": normalizeColor(color),
      }),
    ]),
  );
  return id;
}

// ── Fill / stroke attributes ─────────────────────────────────────────────────

export interface PptxFillPaint {
  fill?: string;
  "fill-opacity"?: number;
}

/** Image element for a fill, wrapped so the blip effects can filter it. */
function fillImage(dataUrl: string, x: number, y: number, w: number, h: number, fx: PptxBlipEffects, ctx: PptxPaintContext): SvgNode {
  const filter = blipFilter(fx, ctx);
  return svgEl("image", {
    x: px(x),
    y: px(y),
    width: px(w),
    height: px(h),
    preserveAspectRatio: "none",
    href: dataUrl,
    ...(filter ? { filter: `url(#${filter})` } : {}),
  });
}

function patternFill(fill: Extract<PptxRenderFill, { kind: "pattern" }>, ctx: PptxPaintContext, origin: { x: number; y: number } | undefined): PptxFillPaint {
  const grid = ctx.patternGrid?.(fill.preset);
  if (!grid) return { fill: normalizeColor(fill.bg) };
  const size = Math.max(2, Math.round(fill.cellPx));
  const id = ctx.nextId("pattern");
  const fgPath = grid
    .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")))
    .filter(Boolean)
    .join("");
  const phase = origin ?? { x: 0, y: 0 };
  // Page-lock the cell grid like GDI/PDF hatches and the genoffice renderer's `patternCanvas`:
  // the first cell boundary must sit on a page multiple of `size`, so the tile grid does not
  // restart at every shape. A bare `phase % size` anchors at the node instead (F11).
  const anchorX = -(((phase.x % size) + size) % size);
  const anchorY = -(((phase.y % size) + size) % size);
  ctx.defs.push(
    svgEl(
      "pattern",
      {
        id,
        patternUnits: "userSpaceOnUse",
        x: px(anchorX),
        y: px(anchorY),
        width: size,
        height: size,
      },
      [svgEl("rect", { x: 0, y: 0, width: size, height: size, fill: normalizeColor(fill.bg) }), fgPath ? svgEl("path", { d: fgPath, fill: normalizeColor(fill.fg) }) : null],
    ),
  );
  return { fill: `url(#${id})` };
}

function imageFill(fill: Extract<PptxRenderFill, { kind: "image" }>, ctx: PptxPaintContext, w: number, h: number, origin: { x: number; y: number } | undefined): PptxFillPaint {
  if (!fill.dataUrl) return { fill: "none" };
  const fx: PptxBlipEffects = { ...(fill.clrChange ? { clrChange: fill.clrChange } : {}), ...(fill.biLevel != null ? { biLevel: fill.biLevel } : {}), ...(fill.duotone ? { duotone: fill.duotone } : {}), ...(fill.lum ? { lum: fill.lum } : {}) };
  const id = ctx.nextId("imgfill");
  const opacity = fill.alpha != null && fill.alpha < 1 ? { "fill-opacity": fill.alpha } : {};
  if (fill.mode === "tile" && fill.tile && ctx.imageSize) {
    const size = ctx.imageSize(fill.dataUrl);
    if (size) {
      const frame = fill.tile.frame ?? { x: 0, y: 0, w, h };
      const tileW = Math.max(size.width * fill.tile.scaleX, 1);
      const tileH = Math.max(size.height * fill.tile.scaleY, 1);
      const xFrac: Record<string, number> = { tl: 0, l: 0, bl: 0, t: 0.5, ctr: 0.5, b: 0.5, tr: 1, r: 1, br: 1 };
      const yFrac: Record<string, number> = { tl: 0, t: 0, tr: 0, l: 0.5, ctr: 0.5, r: 0.5, bl: 1, b: 1, br: 1 };
      const ax = frame.x + (xFrac[fill.tile.algn] ?? 0) * (frame.w - tileW) + fill.tile.txPx;
      const ay = frame.y + (yFrac[fill.tile.algn] ?? 0) * (frame.h - tileH) + fill.tile.tyPx;
      const phase = origin ?? { x: 0, y: 0 };
      const anchorX = ax - Math.ceil((ax + phase.x) / tileW - 1e-6) * tileW;
      const anchorY = ay - Math.ceil((ay + phase.y) / tileH - 1e-6) * tileH;
      ctx.defs.push(
        svgEl("pattern", { id, patternUnits: "userSpaceOnUse", x: px(anchorX), y: px(anchorY), width: px(tileW), height: px(tileH) }, [
          fillImage(fill.dataUrl, 0, 0, tileW, tileH, fx, ctx),
        ]),
      );
      return { fill: `url(#${id})`, ...opacity };
    }
  }
  const rect = fill.fillRect;
  ctx.defs.push(
    svgEl("pattern", { id, patternUnits: "userSpaceOnUse", x: 0, y: 0, width: px(Math.max(w, 1)), height: px(Math.max(h, 1)) }, [
      fillImage(fill.dataUrl, rect ? rect.l * w : 0, rect ? rect.t * h : 0, rect ? (1 - rect.l - rect.r) * w : w, rect ? (1 - rect.t - rect.b) * h : h, fx, ctx),
    ]),
  );
  return { fill: `url(#${id})`, ...opacity };
}

/** `fill`/`fill-opacity` for one render fill. `origin` is the node's absolute page
 *  position, used to phase-lock pattern and tiled fills to the page like GDI/PDF do. */
export function fillPaint(fill: PptxRenderFill, ctx: PptxPaintContext, size: { w: number; h: number }, origin?: { x: number; y: number }): PptxFillPaint {
  switch (fill.kind) {
    case "solid":
      return { fill: normalizeColor(fill.color) };
    case "gradient": {
      const id = ctx.nextId("grad");
      if (fill.radial) {
        // circle/rect/shape radial paths are approximated by the circle geometry.
        const { cx, cy, r } = radialCircleGeometry(size.w, size.h, fill.center, fill.tileRect);
        ctx.defs.push(
          svgEl("radialGradient", { id, gradientUnits: "userSpaceOnUse", cx: px(cx), cy: px(cy), r: px(Math.max(r, 0.01)) }, stopNodes(fill.stops)),
        );
      } else {
        const line = linearGradientLine(fill.angleDeg, fill.scaled, size.w, size.h);
        ctx.defs.push(
          svgEl("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: px(line.x1), y1: px(line.y1), x2: px(line.x2), y2: px(line.y2) }, stopNodes(fill.stops)),
        );
      }
      return { fill: `url(#${id})` };
    }
    case "image":
      return imageFill(fill, ctx, size.w, size.h, origin);
    case "pattern":
      return patternFill(fill, ctx, origin);
    case "none":
    default:
      return { fill: "none" };
  }
}

/** Stroke attributes, including a gradient stroke over the shape box. */
export function strokePaint(stroke: PptxRenderStroke | undefined, ctx: PptxPaintContext, size: { w: number; h: number }): Record<string, SvgAttrValue> {
  if (!stroke) return {};
  const attrs: Record<string, SvgAttrValue> = {
    stroke: normalizeColor(stroke.color),
    "stroke-width": px(Math.max(stroke.widthPx, 0)),
  };
  if (stroke.dash?.length) attrs["stroke-dasharray"] = stroke.dash.map((value) => px(value)).join(" ");
  if (stroke.cap) attrs["stroke-linecap"] = stroke.cap;
  if (stroke.join) attrs["stroke-linejoin"] = stroke.join;
  if (stroke.gradient) {
    const line = linearGradientLine(stroke.gradient.angleDeg, stroke.gradient.scaled, size.w, size.h);
    const id = ctx.nextId("strokegrad");
    ctx.defs.push(svgEl("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: px(line.x1), y1: px(line.y1), x2: px(line.x2), y2: px(line.y2) }, stopNodes(stroke.gradient.stops)));
    attrs.stroke = `url(#${id})`;
  }
  return attrs;
}
