/**
 * `RenderTextLayout` -> SVG text. pptx-render already wrapped, kerned, bidi-reordered and
 * baseline-anchored every glyph run; this file positions runs at their laid-out `x` /
 * `baselineY` (SVG's native alphabetic baseline) and maps run styling onto `<text>`.
 *
 * Deviations from the Konva oracle (recorded in the P0-2 report): no `direction="rtl"`
 * (the run's visual order and x already come from the layout, and RTL anchoring would
 * shift each run by its width), no block-level `vert`/`vert270` rotation and no `txWarp`
 * envelope; per-run `rotate90`/`rotate270` columns are honored.
 */
import { linearGradientLine, normalizeColor, rampStops, shadowFilter, type PptxPaintContext } from "./paint";
import type { PptxGlyphRun, PptxTextLayout } from "./render-tree";
import { mirrorTransform, px, svgEl, svgText, type SvgNode } from "./svg-node";

const SERIF_HINT = /serif|mincho|song|sung|batang|myeongjo|cambria|georgia|garamond|times/i;
const MONO_HINT = /mono|courier|consolas|menlo/i;

/**
 * Display font stack: the deck's family name may not be installed (Microsoft YaHei on
 * macOS, PingFang on Windows), so append the script-appropriate generic. Exact CJK
 * substitution chains are the host's font manager concern, not the canvas's.
 */
function displayFontFamily(name: string): string {
  const family = name.trim();
  if (!family) return "sans-serif";
  const generic = MONO_HINT.test(family) ? "monospace" : SERIF_HINT.test(family) ? "serif" : "sans-serif";
  return `'${family.replace(/'/g, "\\'")}', ${generic}`;
}

function decoration(run: PptxGlyphRun): string | undefined {
  const parts = [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function runTextAttrs(run: PptxGlyphRun, ctx: PptxPaintContext): Record<string, string | number | undefined> {
  const attrs: Record<string, string | number | undefined> = {
    x: px(run.x),
    y: px(run.baselineY),
    "font-family": displayFontFamily(run.fontFamily),
    "font-size": px(run.fontSizePx),
    fill: normalizeColor(run.color),
  };
  if (run.bold) attrs["font-weight"] = "bold";
  if (run.italic) attrs["font-style"] = "italic";
  const textDecoration = decoration(run);
  if (textDecoration) attrs["text-decoration"] = textDecoration;
  const letterSpacing = (run.letterSpacingPx ?? 0) + (run.justifyExtraPx ?? 0);
  if (letterSpacing) attrs["letter-spacing"] = px(letterSpacing);
  if (run.kerningOff) attrs["font-kerning"] = "none";
  if (run.rotate90) attrs.transform = `rotate(90 ${px(run.x)} ${px(run.baselineY)})`;
  else if (run.rotate270) attrs.transform = `rotate(-90 ${px(run.x)} ${px(run.baselineY)})`;
  if (run.outline) {
    attrs.stroke = normalizeColor(run.outline.color);
    attrs["stroke-width"] = px(Math.max(run.outline.widthPx, 0.5));
    attrs["paint-order"] = "stroke";
  }
  const filter = shadowFilter(run.shadow, run.glow, ctx);
  if (filter) attrs.filter = `url(#${filter})`;
  if (run.gradient) {
    const top = run.baselineY - run.fontSizePx * 0.8;
    const line = linearGradientLine(run.gradient.angleDeg, run.gradient.scaled, run.widthPx, run.fontSizePx);
    const id = ctx.nextId("textgrad");
    ctx.defs.push(
      svgEl(
        "linearGradient",
        { id, gradientUnits: "userSpaceOnUse", x1: px(run.x + line.x1), y1: px(top + line.y1), x2: px(run.x + line.x2), y2: px(top + line.y2) },
        rampStops(run.gradient.stops).map((stop) => svgEl("stop", { offset: px(stop.pos), "stop-color": stop.color })),
      ),
    );
    attrs.fill = `url(#${id})`;
  }
  return attrs;
}

function runGlyph(run: PptxGlyphRun, ctx: PptxPaintContext): SvgNode | null {
  if (run.image) {
    const ascent = run.ascentPx ?? run.fontSizePx * 0.8;
    return svgEl("image", {
      x: px(run.x),
      y: px(run.baselineY - ascent),
      width: px(Math.max(run.widthPx, 1)),
      height: px(Math.max(ascent, 1)),
      preserveAspectRatio: "none",
      href: run.image,
    });
  }
  if (!run.text) return null;
  return svgText("text", { "xml:space": "preserve", ...runTextAttrs(run, ctx) }, run.text);
}

function runHighlight(run: PptxGlyphRun, lineTop: number, lineHeight: number): SvgNode | null {
  if (!run.highlight) return null;
  return svgEl("rect", { x: px(run.x), y: px(lineTop), width: px(run.widthPx), height: px(lineHeight), fill: normalizeColor(run.highlight) });
}

interface TextBlockOptions {
  ctx: PptxPaintContext;
  /** Set when the node box (or an ancestor) mirrors: glyphs stay unmirrored. */
  mirror?: { w: number; h: number; flipX: boolean; flipY: boolean };
}

/**
 * One shape/table-cell text body: highlights first (so they never cover a neighbour's
 * glyphs), then the runs, all inside an optional counter-flip group.
 */
export function textBlockPaint(text: PptxTextLayout | undefined, options: TextBlockOptions): SvgNode | null {
  if (!text || !text.lines.length) return null;
  const { ctx } = options;
  const extrusion = text.extrusion;
  const layers: SvgNode[] = [];
  const highlights = text.vert
    ? []
    : text.lines.flatMap((line) => line.runs.map((run) => runHighlight(run, line.top, line.height)).filter((node): node is SvgNode => node != null));
  const paintRuns = (fillOverride: string | undefined): SvgNode[] =>
    text.lines.flatMap((line) =>
      line.runs.map((run) => {
        const node = runGlyph(run, ctx);
        if (!node || !fillOverride) return node;
        return { ...node, attrs: { ...node.attrs, fill: fillOverride, stroke: undefined, filter: undefined } };
      }).filter((node): node is SvgNode => node != null),
    );
  if (extrusion) {
    layers.push(svgEl("g", { transform: `translate(${px(extrusion.dx)} ${px(extrusion.dy)})` }, paintRuns(normalizeColor(extrusion.color))));
  }
  layers.push(...highlights, ...paintRuns(undefined));
  const transform = options.mirror ? mirrorTransform(options.mirror) : undefined;
  return svgEl("g", transform ? { transform } : undefined, layers);
}
