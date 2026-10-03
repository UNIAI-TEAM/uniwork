/**
 * The browser artifact seam. P0-1 builds `@uniwork/office-upstream/pptx-renderer` (the
 * vendored pptx-engine + pptx-ops + pptx-render bundled for the browser); the canvas
 * consumes only the render side of it:
 *
 *   buildRenderSlide(slide, size, { fitWidthPx, media, slideNo }) -> RenderSlide
 *   makeViewport(size, fitWidthPx) -> { widthPx, heightPx, scale }
 *   patternGrid(preset) -> 8x8 mask            (optional; OOXML pattern fills)
 *   presetPath/presetPolygon(preset, w, h, adjust) -> geometry for a hand-built tree
 *                                              (optional; buildRenderSlide resolves presets)
 *
 * Same shape as the XLSX surface: a lazy `import()` behind an injectable `loadModule` prop,
 * so unit tests and jsdom never pull the bundle. The parameter types of the artifact are the
 * shim's, so the loader casts once here and verifies the runtime contract with
 * `assertPptxRendererModule` (a missing export fails loudly instead of rendering nothing).
 */
import type { PptxRenderSlide, PptxSlideSize, PptxViewport } from "./render-tree";

export type PptxMediaResolver = (mediaRef: string) => string | undefined;

export interface PptxBuildSlideOptions {
  fitWidthPx: number;
  /** Image/fill mediaRef -> dataUrl. */
  media?: PptxMediaResolver;
  /** 1-based slide number for `slidenum` fields. */
  slideNo?: number;
}

export interface PptxRendererModule {
  buildRenderSlide: (slide: unknown, size: PptxSlideSize, options: PptxBuildSlideOptions) => PptxRenderSlide;
  makeViewport: (size: PptxSlideSize, fitWidthPx: number) => PptxViewport;
  patternGrid?: (preset: string) => boolean[][];
  /** OOXML preset geometry -> local px path, for a hand-built tree that carries only
   *  `presetGeometry`/`adjust` (the artifact resolves presets in `buildRenderSlide`). */
  presetPath?: (preset: string | undefined, width: number, height: number, adjust?: Record<string, number>) => { d: string } | null;
  presetPolygon?: (preset: string | undefined, width: number, height: number, adjust?: Record<string, number>) => number[] | null;
}

const REQUIRED_EXPORTS: ReadonlyArray<keyof PptxRendererModule> = ["buildRenderSlide", "makeViewport"];

/** Fails loud when the artifact is older/newer than this contract expects. */
export function assertPptxRendererModule(candidate: unknown): PptxRendererModule {
  const module = candidate as Record<string, unknown> | null;
  const missing = REQUIRED_EXPORTS.filter((name) => typeof module?.[name] !== "function");
  if (missing.length) throw new Error(`pptx_renderer_export_missing:${missing.join(",")}`);
  return candidate as PptxRendererModule;
}

/** Production loader: the artifact resolves through the package export. */
export async function loadPptxRendererModule(): Promise<PptxRendererModule> {
  const module = await import("@uniwork/office-upstream/pptx-renderer");
  return assertPptxRendererModule(module);
}
