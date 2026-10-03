"use client";

// UNI-924 A6 (docx-genoffice-parity): the View-area surface — zoom control,
// read-only ruler and the headings navigation pane.
//
// The toolbar group (toolbar/groups/view-zoom.tsx) and the chrome mount are
// wired by the follow-up task; the wiring contract is:
//
//   const controller = getDocxZoomController();
//   controller.attach({
//     zoomElement,                     // surface's `.doc-zoom`
//     scrollElement,                   // surface's `.editor-scroll`
//     pageSize: { widthPx, heightPx }, // sectionPageBox(canvas settings)
//   });
//   ...
//   controller.detach();               // on unmount
//
// Pagination must read the active factor back with `docxZoomFactorOf(docZoom)`
// and pass it to the driver (see the A6 report).

export { DocxNavigationPane, scrollDocxHeadingIntoView, type DocxNavigationPaneProps, type DocxOutlineScrollView } from "./navigation-pane";
export { DocxRuler, type DocxRulerProps } from "./ruler";
export { DocxZoomControl, type DocxZoomControlProps } from "./zoom-control";
export {
  createDocxZoomController,
  docxZoomFactorOf,
  getDocxZoomController,
  installDocxZoomStyles,
  type DocxZoomController,
  type DocxZoomPageSize,
  type DocxZoomTarget,
} from "./zoom-controller";
export type { DocxZoomMode, DocxZoomState } from "./zoom-model";
export type { DocxRulerIndent } from "./ruler-model";
export { docxOutlineFromDoc, type DocxOutlineDocNode, type DocxOutlineItem } from "./headings-outline";
