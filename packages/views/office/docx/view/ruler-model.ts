"use client";

// UNI-924 A6: the read-only ruler's geometry, in CSS px at the display zoom.
//
// OOXML section settings are twips (1/1440 in); CSS px are 96/in, so the ruler
// mirrors docxPageGeometryVars in docx-pagination.ts. Ticks are inch marks
// across the page; margin zones and indent markers are the overlay positions.

import type { RendererSection } from "@uniwork/office-upstream/docs-renderer-editor";

export const DOCX_RULER_TWIPS_PER_INCH = 1440;
export const DOCX_RULER_INCH_PX = 96;

const TWIPS_TO_PX = DOCX_RULER_INCH_PX / DOCX_RULER_TWIPS_PER_INCH;

export interface DocxRulerTick {
  inch: number;
  leftPx: number;
}

export interface DocxRulerModel {
  widthPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  contentWidthPx: number;
  ticks: DocxRulerTick[];
}

function zoomRatio(zoomPercent: number): number {
  return Number.isFinite(zoomPercent) && zoomPercent > 0 ? zoomPercent / 100 : 1;
}

/** The canvas section's ruler geometry, or null when there is no measurable
 *  page (the component then renders nothing). */
export function docxRulerModel(
  settings: RendererSection["settings"] | null | undefined,
  zoomPercent = 100,
): DocxRulerModel | null {
  if (!settings) return null;
  const zoom = zoomRatio(zoomPercent);
  const widthPx = settings.pageWidth * TWIPS_TO_PX * zoom;
  if (!(widthPx > 0)) return null;
  const marginLeftPx = Math.min(Math.max(settings.marginLeft * TWIPS_TO_PX * zoom, 0), widthPx);
  const marginRightPx = Math.min(Math.max(settings.marginRight * TWIPS_TO_PX * zoom, 0), widthPx - marginLeftPx);
  const ticks: DocxRulerTick[] = [];
  const inches = Math.floor(settings.pageWidth / DOCX_RULER_TWIPS_PER_INCH);
  for (let inch = 1; inch <= inches; inch += 1) {
    ticks.push({ inch, leftPx: inch * DOCX_RULER_INCH_PX * zoom });
  }
  return {
    widthPx,
    marginLeftPx,
    marginRightPx,
    contentWidthPx: Math.max(0, widthPx - marginLeftPx - marginRightPx),
    ticks,
  };
}

/** The caret paragraph's direct indents (ProseMirror attrs, twips). An absent
 *  field means "inherited", so its marker is not drawn. */
export interface DocxRulerIndent {
  leftTwips?: number | null;
  rightTwips?: number | null;
  firstLineTwips?: number | null;
}

export interface DocxRulerIndentMarkers {
  /** Left-indent marker; sits on the content edge when the indent is absent. */
  leftPx: number;
  /** Right-indent marker, or null when no direct right indent. */
  rightPx: number | null;
  /** First-line marker (a negative value is a hanging indent), or null. */
  firstLinePx: number | null;
}

function isTwips(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Marker positions from the page's left edge. Null when no indent data is
 *  supplied at all (the ruler then shows geometry only). */
export function docxRulerIndentMarkers(
  indent: DocxRulerIndent | null | undefined,
  model: DocxRulerModel,
  zoomPercent = 100,
): DocxRulerIndentMarkers | null {
  if (!indent) return null;
  const zoom = zoomRatio(zoomPercent);
  const toPx = (twips: number) => twips * TWIPS_TO_PX * zoom;
  const leftTwips = isTwips(indent.leftTwips) ? indent.leftTwips : 0;
  const leftPx = model.marginLeftPx + toPx(leftTwips);
  const rightPx = isTwips(indent.rightTwips) ? model.widthPx - model.marginRightPx - toPx(indent.rightTwips) : null;
  const firstLinePx =
    isTwips(indent.firstLineTwips) && indent.firstLineTwips !== 0 ? leftPx + toPx(indent.firstLineTwips) : null;
  return { leftPx, rightPx, firstLinePx };
}
