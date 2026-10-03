/**
 * Deck-level adapter over the artifact: one renderer per (deck, revision) that builds
 * `RenderSlide` trees at any fit width and serializes the same SVG for thumbnails.
 *
 * The deck model itself stays opaque to the view layer — only the artifact reads it — so
 * this file never imports the engine types.
 */
import { buildSlideSvg } from "./build-slide-svg";
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

export interface PptxDeckRendererOptions {
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
  /** `data:` URL of the same SVG the canvas mounts, for the rail thumbnails. */
  buildThumbnail(slideIndex: number, fitWidthPx: number, title?: string): string | null;
}

const RENDITION_CACHE_LIMIT = 8;

export function createPptxDeckRenderer(
  module: PptxRendererModule,
  input: PptxRenderInput,
  options: PptxDeckRendererOptions,
): PptxDeckRenderer {
  const { deck } = input;
  const size = deck.size ?? DEFAULT_SLIDE_SIZE;
  const cache = new Map<string, PptxRenderSlide | null>();
  const baseViewport = module.makeViewport(size, 1000);
  const aspect = baseViewport.widthPx > 0 ? baseViewport.heightPx / baseViewport.widthPx : 9 / 16;
  const buildSlide = (slideIndex: number, fitWidthPx: number): PptxRenderSlide | null => {
    const slide = deck.slides[slideIndex];
    if (slide == null) return null;
    const key = `${slideIndex}:${Math.round(fitWidthPx)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const built = module.buildRenderSlide(slide, size, {
      fitWidthPx,
      slideNo: slideIndex + 1,
      ...(input.resolveMedia ? { media: input.resolveMedia } : {}),
    });
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
  return {
    slideCount: deck.slides.length,
    aspect,
    viewport: (fitWidthPx) => module.makeViewport(size, fitWidthPx),
    buildSlide,
    buildThumbnail: (slideIndex, fitWidthPx, title) => {
      const slide = buildSlide(slideIndex, fitWidthPx);
      if (!slide) return null;
      const doc = buildSlideSvg(slide, { ...svgOptions, idPrefix: `${options.idPrefix}-t${slideIndex}` });
      return svgDataUrl(slideSvgMarkup(doc.root, doc, title ? { title } : {}));
    },
  };
}
