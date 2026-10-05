"use client";

// UNI-924 A6 (docx-genoffice-parity): the DOCX zoom model.
//
// The document canvas renders `div.doc-zoom` (use-docx-tiptap-handle.ts) —
// the same element genoffice scales with the CSS `zoom` property (App.tsx
// docZoomStyle). This module keeps the pure math (range, steps, presets, fit
// modes) so it is testable without a DOM; the DOM half lives in
// ./zoom-controller.

export const DOCX_ZOOM_MIN_PERCENT = 50;
export const DOCX_ZOOM_MAX_PERCENT = 200;
export const DOCX_ZOOM_DEFAULT_PERCENT = 100;
export const DOCX_ZOOM_STEP_PERCENT = 10;

/** The preset stops the zoom picker offers (genoffice/Word parity). */
export const DOCX_ZOOM_PRESETS: readonly number[] = [50, 75, 100, 125, 150, 200];

export type DocxZoomMode = "manual" | "fit-width" | "fit-page";

export interface DocxZoomState {
  percent: number;
  mode: DocxZoomMode;
}

/** Clamp to the supported range; a non-finite input falls back to 100%. */
export function clampDocxZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return DOCX_ZOOM_DEFAULT_PERCENT;
  return Math.min(DOCX_ZOOM_MAX_PERCENT, Math.max(DOCX_ZOOM_MIN_PERCENT, Math.round(percent)));
}

/** One step for the +/- buttons and Ctrl+scroll: fixed 10% stops. */
export function stepDocxZoomPercent(percent: number, direction: 1 | -1): number {
  return clampDocxZoomPercent(percent + direction * DOCX_ZOOM_STEP_PERCENT);
}

/** The preset stops plus the live value when it is not one of them, so the
 *  picker can always render the current zoom. */
export function docxZoomOptions(percent: number): number[] {
  const value = clampDocxZoomPercent(percent);
  if (DOCX_ZOOM_PRESETS.includes(value)) return [...DOCX_ZOOM_PRESETS];
  return [...DOCX_ZOOM_PRESETS, value].sort((a, b) => a - b);
}

/** Viewport space the fit modes leave free before dividing by the page box —
 *  genoffice's fit padding (App.tsx zoomFit: `pad = 48`). */
export const DOCX_ZOOM_FIT_PADDING_PX = 48;

export interface DocxFitInput {
  /** Measured viewport (the scroll pane) in CSS px. */
  availableWidthPx: number;
  availableHeightPx: number;
  /** Page box at 100%, in CSS px (engine twips x 96 / 1440). */
  pageWidthPx: number;
  pageHeightPx: number;
  paddingPx?: number;
}

/**
 * Word's page-width / whole-page zoom as an integer percent, or null when the
 * viewport or page box cannot be measured yet (best effort: the caller keeps
 * the current zoom). `fit-page` uses the smaller of the two ratios, like
 * genoffice's zoomFit.
 */
export function fitDocxZoomPercent(mode: "width" | "page", input: DocxFitInput): number | null {
  const padding = input.paddingPx ?? DOCX_ZOOM_FIT_PADDING_PX;
  if (!(input.pageWidthPx > 0) || !(input.availableWidthPx > padding)) return null;
  const widthFit = ((input.availableWidthPx - padding) / input.pageWidthPx) * 100;
  if (mode === "width") return clampDocxZoomPercent(Math.floor(widthFit));
  if (!(input.pageHeightPx > 0) || !(input.availableHeightPx > padding)) return null;
  const heightFit = ((input.availableHeightPx - padding) / input.pageHeightPx) * 100;
  return clampDocxZoomPercent(Math.floor(Math.min(widthFit, heightFit)));
}

/** Breathing room kept beside the page when the canvas is narrower than it. */
export const DOCX_ZOOM_NARROW_PADDING_PX = 24;

export interface DocxNarrowFitInput {
  availableWidthPx: number;
  pageWidthPx: number;
  paddingPx?: number;
}

/**
 * The zoom actually painted: the user's percent scaled so a 100% page never
 * outgrows a narrow canvas (Word's fit-width on a phone). A canvas that already
 * holds the page leaves the user's percent untouched. Unmeasurable input
 * keeps the user's percent. The result may go below the 50% user minimum - it is a layout
 * fit, not a setting.
 */
export function effectiveDocxZoomPercent(percent: number, input: DocxNarrowFitInput): number {
  const padding = input.paddingPx ?? DOCX_ZOOM_NARROW_PADDING_PX;
  if (!(input.pageWidthPx > 0) || !(input.availableWidthPx > padding)) return percent;
  const fit = Math.max(1, Math.floor(((input.availableWidthPx - padding) / input.pageWidthPx) * 100));
  // Relative, so the +/- steps still move the page on a phone.
  return Math.max(1, Math.round((percent * Math.min(100, fit)) / 100));
}
