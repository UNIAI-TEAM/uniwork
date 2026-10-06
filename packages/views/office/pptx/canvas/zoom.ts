/**
 * Zoom / fit math for the slide canvas. Zoom is relative to **fit width** (100% = the slide
 * fills the available width, which is also the tree's build width), so a container resize
 * keeps the reading size instead of silently changing the zoom percentage.
 */

export const PPTX_ZOOM_MIN = 0.25;
export const PPTX_ZOOM_MAX = 4;

/** Zoom stops used by the in/out buttons (fractions of fit width). */
export const PPTX_ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Default build width for the first paint / a container with no measured width yet. */
export const PPTX_FALLBACK_FIT_WIDTH = 960;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(Math.max(zoom, PPTX_ZOOM_MIN), PPTX_ZOOM_MAX);
}

/** Next stop above/below the current zoom (never skips a stop, clamps at the ends). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const current = clampZoom(zoom);
  if (direction > 0) {
    const next = PPTX_ZOOM_STEPS.find((stop) => stop > current + 1e-6);
    return next ?? PPTX_ZOOM_MAX;
  }
  const lower = [...PPTX_ZOOM_STEPS].reverse().find((stop) => stop < current - 1e-6);
  return lower ?? PPTX_ZOOM_MIN;
}

export function zoomPercent(zoom: number): number {
  return Math.round(clampZoom(zoom) * 100);
}

/** The width the render tree is built at: the measured container width, never 0/NaN. */
export function resolveFitWidth(containerWidthPx: number, fallback = PPTX_FALLBACK_FIT_WIDTH): number {
  if (!Number.isFinite(containerWidthPx) || containerWidthPx < 1) return fallback;
  return Math.round(containerWidthPx);
}

/** On-screen size of the slide at the given zoom (the slide's own px size at fit is the fit width). */
export function slideDisplaySize(fitWidthPx: number, zoom: number, aspect: number): { widthPx: number; heightPx: number } {
  const widthPx = fitWidthPx * clampZoom(zoom);
  return { widthPx, heightPx: widthPx * (Number.isFinite(aspect) && aspect > 0 ? aspect : 9 / 16) };
}
