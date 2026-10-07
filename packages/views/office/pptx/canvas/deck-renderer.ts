/**
 * Deck-level adapter over the artifact: one renderer per (deck, revision) that builds
 * `RenderSlide` trees at any fit width and serializes the same SVG for thumbnails.
 *
 * The deck model itself stays opaque to the view layer — only the artifact reads it — so
 * this file never imports the engine types.
 */
import { buildSlideSvg } from "./build-slide-svg";
import { createCanvasFontMetrics, type PptxMeasureContext } from "./canvas-metrics";
import type { PptxCanvasPalette, PptxImageSize } from "./paint";
import type { PptxRendererModule } from "./renderer-module";
import type { PptxRenderSlide, PptxSlideSize, PptxViewport } from "./render-tree";
import { slideSvgMarkup, svgDataUrl } from "./svg-node";

export interface PptxDeckModel {
  slides: readonly unknown[];
  /** EMU slide size. Absent on a deck that never declared one (the engine falls back to the
   *  Office 16:9 base when a presentation has no `p:sldSz`), so the canvas does the same. */
  size?: PptxSlideSize;
}

/** Office 16:9 base (pptx-engine's default when the presentation declares no size). */
const DEFAULT_SLIDE_SIZE: PptxSlideSize = { cx: 12192000, cy: 6858000 };

export interface PptxRenderInput {
  deck: PptxDeckModel;
  /** Optional mediaRef -> dataUrl resolver for pictures and image fills. */
  resolveMedia?: (mediaRef: string) => string | undefined;
  /** Natural pixel size of a data URL (tiled picture/image fills). */
  imageSize?: (dataUrl: string) => PptxImageSize | undefined;
  /** Cache key of the model generation; a new value rebuilds every rendition. */
  revision?: string | number;
}

interface PptxDeckRendererOptions {
  /** 2D context source for text measurement (tests inject one); defaults to the DOM canvas. */
  measureContext?: () => PptxMeasureContext | null;
  idPrefix: string;
  palette: PptxCanvasPalette;
}

export interface PptxDeckRenderer {
  readonly slideCount: number;
  /** height / width of the deck's slide size. */
  readonly aspect: number;
  /** Artifact-computed canvas geometry at the given fit width. */
  viewport(fitWidthPx: number): PptxViewport;
  /** Render tree for one slide (null when the index is out of range). */
  buildSlide(slideIndex: number, fitWidthPx: number): PptxRenderSlide | null;
  /** Standalone SVG document of one slide, built with the canvas's own SVG options (pattern
   *  grids, preset geometry, image sizes), so a print copy draws what the canvas draws. */
  buildSlideMarkup(slideIndex: number, fitWidthPx: number, title?: string): PptxSlideMarkup | null;
  /** `data:` URL of the same SVG the canvas mounts, for the rail thumbnails. */
  buildThumbnail(slideIndex: number, fitWidthPx: number, title?: string): string | null;
}

interface PptxSlideMarkup {
  markup: string;
  widthPx: number;
  heightPx: number;
}

const RENDITION_CACHE_LIMIT = 8;

export function createPptxDeckRenderer(
  module: PptxRendererModule,
  input: PptxRenderInput,
  options: PptxDeckRendererOptions,
): PptxDeckRenderer {
  const { deck } = input;
  const size = deck.size ?? DEFAULT_SLIDE_SIZE;
  // One measurer per renderer, shared by the canvas and the thumbnails (both go through buildSlide).
  const metrics = module.HeuristicMetrics ? createCanvasFontMetrics(new module.HeuristicMetrics(), options.measureContext) : undefined;
  const cache = new Map<string, PptxRenderSlide | null>();
  const baseViewport = module.makeViewport(size, 1000);
  const aspect = baseViewport.widthPx > 0 ? baseViewport.heightPx / baseViewport.widthPx : 9 / 16;
  const buildSlide = (slideIndex: number, fitWidthPx: number): PptxRenderSlide | null => {
    const slide = deck.slides[slideIndex];
    if (slide == null) return null;
    const key = `${slideIndex}:${Math.round(fitWidthPx)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    // A slide the artifact cannot build (corrupt geometry, an unsupported node) degrades to a
    // null rendition -- the canvas shows its per-slide pending state and the rail skips that
    // thumbnail -- instead of throwing through React and taking the whole editor down.
    let built: PptxRenderSlide | null = null;
    try {
      built = module.buildRenderSlide(slide, size, {
        fitWidthPx,
        slideNo: slideIndex + 1,
        ...(metrics ? { metrics } : {}),
        ...(input.resolveMedia ? { media: input.resolveMedia } : {}),
      });
    } catch {
      built = null;
    }
    if (cache.size >= RENDITION_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, built);
    return built;
  };
  const svgOptions = {
    palette: options.palette,
    ...(input.imageSize ? { imageSize: input.imageSize } : {}),
    ...(module.patternGrid ? { patternGrid: module.patternGrid } : {}),
    ...(module.presetPath ? { presetPath: module.presetPath } : {}),
    ...(module.presetPolygon ? { presetPolygon: module.presetPolygon } : {}),
  };
  const buildSlideMarkup = (slideIndex: number, fitWidthPx: number, title?: string): PptxSlideMarkup | null => {
    const slide = buildSlide(slideIndex, fitWidthPx);
    if (!slide) return null;
    try {
      const doc = buildSlideSvg(slide, { ...svgOptions, idPrefix: `${options.idPrefix}-t${slideIndex}` });
      return { markup: slideSvgMarkup(doc.root, doc, title ? { title } : {}), widthPx: doc.widthPx, heightPx: doc.heightPx };
    } catch {
      return null;
    }
  };
  return {
    slideCount: deck.slides.length,
    aspect,
    viewport: (fitWidthPx) => module.makeViewport(size, fitWidthPx),
    buildSlide,
    buildSlideMarkup,
    buildThumbnail: (slideIndex, fitWidthPx, title) => {
      const built = buildSlideMarkup(slideIndex, fitWidthPx, title);
      return built ? svgDataUrl(built.markup) : null;
    },
  };
}
