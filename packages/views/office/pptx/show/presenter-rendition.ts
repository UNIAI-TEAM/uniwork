/**
 * Presenter rendition plumbing (UNI-927 WIRE-CANVAS-BIND).
 *
 * Pure conversions from what the canvas already built to what the presenter
 * consumes: the SAME `buildSlideSvg` document the editor mounts, never the
 * 160px rail thumbnail (P0-2 F6). Kept out of `pptx-editor.tsx`, which is at
 * its line budget.
 */
import { buildSlideSvg, type SlideSvgDocument, type SlideSvgOptions } from "../canvas/build-slide-svg";
import type { PptxCanvasContent } from "../canvas/pptx-canvas-surface";
import type { PptxDeckRenderer } from "../canvas/deck-renderer";

/** The slide's canvas document as presenter content (the hidden flag is kept). */
export function presenterSlideContent(document: SlideSvgDocument | null, hidden?: boolean): PptxCanvasContent | null {
  if (!document) return null;
  return { root: document.root, widthPx: document.widthPx, heightPx: document.heightPx, ...(hidden ? { hidden: true } : {}) };
}

/** The next slide's rendition for the presenter preview; null on the last slide or
 *  when the artifact cannot build it (the preview then shows its pending state). */
export function presenterNextSlideContent(
  renderer: PptxDeckRenderer | null,
  slideIndex: number,
  fitWidthPx: number,
  options: SlideSvgOptions,
): PptxCanvasContent | null {
  const next = renderer?.buildSlide(slideIndex, fitWidthPx) ?? null;
  if (!next) return null;
  try {
    return presenterSlideContent(buildSlideSvg(next, options), next.hidden);
  } catch {
    return null;
  }
}
