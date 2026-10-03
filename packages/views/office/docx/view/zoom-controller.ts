"use client";

// UNI-924 A6: the attachable DOCX zoom controller.
//
// The controller takes the surface's `div.doc-zoom` element (rendered by
// use-docx-tiptap-handle.ts inside `.editor-scroll`) and writes a single CSS
// custom property on it:
//
//     --docx-zoom: <ratio>        (100% -> "1")
//
// A stylesheet rule (installed once, id below) turns that property into CSS
// `zoom` — the same property genoffice drives from App.tsx (`docZoomStyle`) and
// the one the vendored print rules already neutralize (`@media print {
// .doc-zoom { zoom: 1 !important } }`). A transform is deliberately NOT used:
// the pagination driver measures the live canvas rects with a zoom factor
// (docx-pagination.ts `factor`; pagination-measure.ts divides by it), and a
// transform would also break caret/hit-testing geometry.
//
// Zoom-aware measurement: `docxZoomFactorOf` reads the property back. The
// follow-up wiring must feed that factor to the pagination driver — until then
// the driver measures with factor 1 and must not run at zoom != 100.

import {
  DOCX_ZOOM_DEFAULT_PERCENT,
  DOCX_ZOOM_FIT_PADDING_PX,
  clampDocxZoomPercent,
  fitDocxZoomPercent,
  stepDocxZoomPercent,
  type DocxZoomState,
} from "./zoom-model";

export const DOCX_ZOOM_STYLE_ELEMENT_ID = "uniwork-docx-zoom";
export const DOCX_ZOOM_DATA_ATTRIBUTE = "data-docx-zoom";
export const DOCX_ZOOM_CSS_VAR = "--docx-zoom";

/** Mount the property -> zoom rule once per document. Idempotent. */
export function installDocxZoomStyles(doc: Document | null | undefined): void {
  if (!doc || doc.getElementById(DOCX_ZOOM_STYLE_ELEMENT_ID)) return;
  const style = doc.createElement("style");
  style.id = DOCX_ZOOM_STYLE_ELEMENT_ID;
  style.textContent = `[${DOCX_ZOOM_DATA_ATTRIBUTE}]{zoom:var(${DOCX_ZOOM_CSS_VAR},1);}`;
  (doc.head ?? doc.documentElement)?.appendChild(style);
}

/** The zoom ratio (`1` = 100%) written by the controller, for zoom-aware
 *  measurement. A missing element or property reads as 1. */
export function docxZoomFactorOf(element: HTMLElement | null | undefined): number {
  const raw = element?.style.getPropertyValue(DOCX_ZOOM_CSS_VAR) ?? "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export interface DocxZoomPageSize {
  widthPx: number;
  heightPx: number;
}

export interface DocxZoomTarget {
  /** The surface's `.doc-zoom` element; carries the zoom property. */
  zoomElement: HTMLElement;
  /** Viewport measured for the fit modes and the one the wheel/Ctrl+0
   *  listeners attach to; defaults to `zoomElement`. */
  scrollElement?: HTMLElement | null;
  /** Page box in CSS px at 100% (`sectionPageBox` of the canvas section). */
  pageSize?: DocxZoomPageSize | null;
  /** Fit padding override; defaults to genoffice's 48px. */
  fitPaddingPx?: number;
}

export interface DocxZoomController {
  getState(): DocxZoomState;
  subscribe(listener: (state: DocxZoomState) => void): () => void;
  /** Attach to a mounted surface. Re-attaching replaces the previous target;
   *  the zoom state (a view setting) is kept across documents. */
  attach(target: DocxZoomTarget): void;
  /** Detach listeners and remove the property — call when the surface unmounts. */
  detach(): void;
  /** Detach and drop every subscriber; the controller is not reusable after. */
  dispose(): void;
  setPercent(percent: number): void;
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  fit(mode: "width" | "page"): void;
  /** The wiring learns the page box after open; refits when a fit mode is active. */
  setPageSize(pageSize: DocxZoomPageSize | null): void;
}

/** Resolved attachment: the optional target fields filled in. */
interface DocxZoomAttachment {
  zoomElement: HTMLElement;
  scrollElement: HTMLElement;
  pageSize: DocxZoomPageSize | null;
  fitPaddingPx: number;
}

export function createDocxZoomController(): DocxZoomController {
  let state: DocxZoomState = { percent: DOCX_ZOOM_DEFAULT_PERCENT, mode: "manual" };
  const listeners = new Set<(state: DocxZoomState) => void>();
  let attachment: DocxZoomAttachment | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const applyZoom = (): void => {
    if (!attachment) return;
    const element = attachment.zoomElement;
    installDocxZoomStyles(element.ownerDocument);
    element.setAttribute(DOCX_ZOOM_DATA_ATTRIBUTE, "");
    element.style.setProperty(DOCX_ZOOM_CSS_VAR, String(state.percent / 100));
  };

  const publish = (next: DocxZoomState): void => {
    if (next.percent === state.percent && next.mode === state.mode) return;
    state = next;
    applyZoom();
    for (const listener of [...listeners]) listener(state);
  };

  const setManual = (percent: number): void => {
    publish({ percent: clampDocxZoomPercent(percent), mode: "manual" });
  };

  const zoomIn = (): void => setManual(stepDocxZoomPercent(state.percent, 1));
  const zoomOut = (): void => setManual(stepDocxZoomPercent(state.percent, -1));
  const reset = (): void => setManual(DOCX_ZOOM_DEFAULT_PERCENT);

  const fitTo = (mode: "width" | "page"): void => {
    if (!attachment) return;
    const viewport = attachment.scrollElement;
    const page = attachment.pageSize;
    if (!page) return;
    const percent = fitDocxZoomPercent(mode, {
      availableWidthPx: viewport.clientWidth,
      availableHeightPx: viewport.clientHeight,
      pageWidthPx: page.widthPx,
      pageHeightPx: page.heightPx,
      paddingPx: attachment.fitPaddingPx,
    });
    if (percent === null) return;
    publish({ percent, mode: mode === "width" ? "fit-width" : "fit-page" });
  };

  const refit = (): void => {
    if (state.mode === "fit-width") fitTo("width");
    else if (state.mode === "fit-page") fitTo("page");
  };

  const onWheel = (event: WheelEvent): void => {
    if (!attachment || (!event.ctrlKey && !event.metaKey)) return;
    // Ctrl+wheel is the browser's own page zoom; the canvas owns the gesture.
    // Prevented even below the step threshold, or the page would zoom.
    event.preventDefault();
    if (Math.abs(event.deltaY) < 4) return;
    if (event.deltaY < 0) zoomIn();
    else zoomOut();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!attachment || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
    if (event.key !== "0") return;
    event.preventDefault();
    reset();
  };

  const detach = (): void => {
    const current = attachment;
    attachment = null;
    if (!current) return;
    current.scrollElement.removeEventListener("wheel", onWheel);
    current.scrollElement.removeEventListener("keydown", onKeyDown);
    resizeObserver?.disconnect();
    resizeObserver = null;
    current.zoomElement.removeAttribute(DOCX_ZOOM_DATA_ATTRIBUTE);
    current.zoomElement.style.removeProperty(DOCX_ZOOM_CSS_VAR);
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attach(target) {
      detach();
      const next: DocxZoomAttachment = {
        zoomElement: target.zoomElement,
        scrollElement: target.scrollElement ?? target.zoomElement,
        pageSize: target.pageSize ?? null,
        fitPaddingPx: target.fitPaddingPx ?? DOCX_ZOOM_FIT_PADDING_PX,
      };
      attachment = next;
      applyZoom();
      next.scrollElement.addEventListener("wheel", onWheel, { passive: false });
      next.scrollElement.addEventListener("keydown", onKeyDown);
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => refit());
        resizeObserver.observe(next.scrollElement);
      }
      refit();
    },
    detach,
    dispose() {
      detach();
      listeners.clear();
    },
    setPercent: setManual,
    zoomIn,
    zoomOut,
    reset,
    fit: fitTo,
    setPageSize(pageSize) {
      if (!attachment) return;
      attachment = { ...attachment, pageSize };
      refit();
    },
  };
}

let sharedController: DocxZoomController | null = null;

/** The one controller the DOCX view shares: the View tab's zoom group and the
 *  chrome mount must drive the same surface, and a toolbar group only receives
 *  DocxToolbarGroupContext — no controller prop. */
export function getDocxZoomController(): DocxZoomController {
  sharedController ??= createDocxZoomController();
  return sharedController;
}
