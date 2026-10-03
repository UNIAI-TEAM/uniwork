"use client";

// UNI-924 A6 (docx-genoffice-parity): the View-area surface — zoom control,
// read-only ruler and the headings navigation pane.
//
// Wiring (A6-wire): the toolbar groups drive the shared controller and the
// pane; the chrome mount (docx-view-chrome.tsx) — rendered by docx-editor.tsx
// as the first child of the canvas column — attaches that controller to the
// live surface and draws the ruler above the pages. The surface, its page
// geometry and the document outline are resolved from the DOM in
// ./surface-targets and ./headings-outline because the editor handle exposes
// no engine accessors.
//
// Pagination must read the active factor back with `docxZoomFactorOf(docZoom)`
// and pass it to the driver (see the A6 report).

export { DocxViewChrome, type DocxViewChromeProps } from "./docx-view-chrome";
export { DocxNavigationHost, type DocxNavigationHostProps } from "./navigation-host";
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
