"use client";

// UNI-924 A6: the DOM contract between the zoom controller (writer) and every
// zoom-aware measurement (readers: the pagination driver, the note areas).
//
// The controller writes a single CSS custom property on the surface's
// `.doc-zoom` element:
//
//     --docx-zoom: <ratio>        (100% -> "1")
//
// `docxZoomFactorOf` reads it back. The reader lives here, not in
// ./zoom-controller, so a reader does not depend on the controller's state
// code; a missing element or property reads as 1, so an unwired surface keeps
// measuring unzoomed.

export const DOCX_ZOOM_CSS_VAR = "--docx-zoom";

/** The zoom ratio (`1` = 100%) the controller wrote, for zoom-aware
 *  measurement. A missing element or property reads as 1. */
export function docxZoomFactorOf(element: HTMLElement | null | undefined): number {
  const raw = element?.style.getPropertyValue(DOCX_ZOOM_CSS_VAR) ?? "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
