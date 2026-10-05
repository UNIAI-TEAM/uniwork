/**
 * Browser font metrics for the vendored layout engine. The engine measures every run with
 * `opts.metrics ?? new HeuristicMetrics()` (fixed per-character-class em widths) while the SVG
 * is drawn with the real face, so Georgia/Verdana text overlapped and Calibri text gapped.
 * This provider measures with a 2D canvas using the same family stack `text.ts` renders.
 * Line metrics (ascent/descent/lineHeight) stay the fallback's, so vertical layout is unchanged.
 *
 * A font that finishes loading after a measurement is picked up on the next revision rebuild
 * (the renderer is created per deck revision); nothing here waits on `document.fonts`.
 */
import type { PptxFontMetricsProvider, PptxRunStyle } from "./renderer-module";
import { displayFontFamily } from "./text";

/** The slice of CanvasRenderingContext2D the provider needs. */
export interface PptxMeasureContext {
  font: string;
  fontKerning?: string;
  measureText(text: string): { width: number };
}

const WIDTH_CACHE_LIMIT = 4000;

function fontShorthand(style: PptxRunStyle): string {
  return `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.fontSizePx}px ${displayFontFamily(style.fontFamily)}`;
}

/** A 2D context from the DOM, or null where none exists (jsdom without canvas, node). */
function defaultMeasureContext(): PptxMeasureContext | null {
  try {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1).getContext("2d") as PptxMeasureContext | null;
    if (typeof document !== "undefined") return document.createElement("canvas").getContext("2d");
  } catch {
    // jsdom's "not implemented" getContext, or a locked-down host: keep the heuristic.
  }
  return null;
}

/** Undefined when no 2D context is available, so the engine keeps its deterministic heuristic. */
export function createCanvasFontMetrics(
  fallback: PptxFontMetricsProvider,
  getContext: () => PptxMeasureContext | null = defaultMeasureContext,
): PptxFontMetricsProvider | undefined {
  const ctx = getContext();
  if (!ctx) return undefined;
  const widths = new Map<string, number>();
  return {
    metrics: (style) => fallback.metrics(style),
    measure: (text, style) => {
      const kerningOff = style.kerning === false;
      const font = fontShorthand(style);
      const key = `${kerningOff ? "n" : "k"}|${font}|${text}`;
      const hit = widths.get(key);
      if (hit !== undefined) return hit;
      ctx.font = font;
      // A context without `fontKerning` (older Safari) cannot measure a kern-off run unkerned. The
      // draw layer still sets font-kerning:none for it, so the two disagree by the kerning delta
      // (sub-pixel per run); the run's textLength pin in text.ts absorbs that residual.
      if ("fontKerning" in ctx) ctx.fontKerning = kerningOff ? "none" : "auto";
      const width = ctx.measureText(text).width;
      // A non-finite width would poison the layout; defer to the heuristic for that run.
      const value = Number.isFinite(width) ? width : fallback.measure(text, style);
      if (widths.size >= WIDTH_CACHE_LIMIT) widths.delete(widths.keys().next().value!);
      widths.set(key, value);
      return value;
    },
  };
}
